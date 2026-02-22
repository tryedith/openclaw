import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";
import {
  collectWhatsAppDebug,
  ensureOwnerOnlyWhatsAppAccess,
} from "@/lib/gateway/whatsapp-security";

interface WebLoginWaitResult {
  connected: boolean;
  message: string;
}

function isGatewayRestartingError(error?: string): boolean {
  const message = String(error ?? "").toLowerCase();
  return (
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    message.includes("connection timeout") ||
    message.includes("connection closed before completing")
  );
}


// POST /api/instances/[id]/channels/[channel]/login/wait
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; channel: string }> }
) {
  const { id, channel } = await params;

  if (channel !== "whatsapp") {
    return NextResponse.json({ error: "Unsupported channel for login flow" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  const body = (await request.json().catch(() => ({}))) as {
    timeoutMs?: number;
    accountId?: string;
  };

  const waitTimeoutMs =
    typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)
      ? Math.max(0, body.timeoutMs)
      : 120_000;
  const requestedAccountId =
    typeof body.accountId === "string" && body.accountId.trim().length > 0
      ? body.accountId.trim()
      : "default";

  try {
    const result = await gatewayRpc<WebLoginWaitResult>({
      gatewayUrl,
      token,
      method: "web.login.wait",
      rpcParams: {
        timeoutMs: waitTimeoutMs,
        accountId: requestedAccountId,
      },
      timeoutMs: Math.max(15_000, waitTimeoutMs + 10_000),
    });

    if (!result.ok) {
      const debug = await collectWhatsAppDebug({ gatewayUrl, token });
      if (isGatewayRestartingError(result.error)) {
        return NextResponse.json(
          {
            error: "Gateway is restarting",
            details: "Please wait a moment and try again.",
            retryable: true,
            debug,
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Failed to check WhatsApp login", details: result.error, debug },
        { status: 500 }
      );
    }

    const debug = await collectWhatsAppDebug({ gatewayUrl, token });

    if (result.payload?.connected === true) {
      const accessResult = await ensureOwnerOnlyWhatsAppAccess({
        gatewayUrl,
        token,
        fallbackAccountId: requestedAccountId,
        debug,
      });
      if (!accessResult.ok) {
        return NextResponse.json(
          {
            error: "WhatsApp linked but failed to secure DM access",
            details: accessResult.error,
            debug,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      connected: result.payload?.connected === true,
      message: result.payload?.message ?? "Waiting for QR scan.",
      debug,
    });
  } catch (error) {
    const debug = await collectWhatsAppDebug({ gatewayUrl, token }).catch(() => null);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error), debug },
      { status: 500 }
    );
  }
}
