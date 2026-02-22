import { createClient } from "@/lib/supabase/server";
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

// POST /api/instances/[id]/chat - Proxy chat messages to the user's gateway
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get instance from database
  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
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

  // Build session key for this user
  const sessionKey = buildSessionKey(user.id);
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
        timeoutMs: 60000, // Chat can take a while
      });

      if (result.ok) {
        const runId = result.payload?.runId;
        if (!runId) {
          return NextResponse.json(
            { error: "Gateway did not return a run ID" },
            { status: 502 }
          );
        }

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

    console.error("[chat] Gateway error:", lastGatewayError);
    if (isTransientGatewayError(lastGatewayError)) {
      return NextResponse.json(
        {
          error: "Gateway restarting; retry in a few seconds",
          details: lastGatewayError,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({
      error: "Gateway error",
      details: lastGatewayError,
    }, { status: 500 });
  } catch (error) {
    console.error("[chat] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
