import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/admin/audit";
import { NextResponse } from "next/server";
import { gatewayRpc, buildSessionKey } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";
import { randomUUID } from "crypto";

interface ChatSendResult {
  runId?: string;
  status?: string;
}

const CHAT_SEND_MAX_ATTEMPTS = 4;
const CHAT_SEND_RETRY_DELAYS_MS = [300, 700, 1400] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientGatewayError(errorMessage: string | undefined): boolean {
  if (!errorMessage) {return false;}
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("websocket error") ||
    normalized.includes("connection timeout") ||
    normalized.includes("connection closed before completing") ||
    normalized.includes("socket hang up") ||
    normalized.includes("rpc error")
  );
}

// POST /api/admin/instances/[id]/chat - Admin: send chat message to any instance
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const admin = createAdminClient();

  const { data: instance, error } = await admin
    .from("instances")
    .select("*, users!inner(id)")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url) {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const body = (await request.json()) as { message?: string };
  const message = typeof body.message === "string" ? body.message : "";

  if (!message.trim().length) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  // Use the instance owner's session key so admin sees the same conversation
  const sessionKey = buildSessionKey(instance.user_id);
  const idempotencyKey = randomUUID();

  try {
    let lastGatewayError: string | undefined;
    for (let attempt = 1; attempt <= CHAT_SEND_MAX_ATTEMPTS; attempt += 1) {
      const result = await gatewayRpc<ChatSendResult>({
        gatewayUrl,
        token,
        method: "chat.send",
        rpcParams: {
          sessionKey,
          message,
          idempotencyKey,
        },
        timeoutMs: 60000,
      });

      if (result.ok) {
        const runId = result.payload?.runId;
        if (!runId) {
          return NextResponse.json(
            { error: "Gateway did not return a run ID" },
            { status: 502 }
          );
        }

        void logAdminAction(auth.user.id, "chat.send", "instance", id, {
          messageLength: message.length,
        });

        return NextResponse.json({
          runId,
          status: result.payload?.status ?? "started",
        });
      }

      lastGatewayError = result.error;
      if (!isTransientGatewayError(result.error) || attempt >= CHAT_SEND_MAX_ATTEMPTS) {
        break;
      }

      const delayMs = CHAT_SEND_RETRY_DELAYS_MS[attempt - 1] ?? 1500;
      await sleep(delayMs);
    }

    console.error("[admin/chat] Gateway error:", lastGatewayError);
    if (isTransientGatewayError(lastGatewayError)) {
      return NextResponse.json(
        { error: "Gateway restarting; retry in a few seconds", details: lastGatewayError },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Gateway error", details: lastGatewayError }, { status: 500 });
  } catch (error) {
    console.error("[admin/chat] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
