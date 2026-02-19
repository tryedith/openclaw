import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

interface WebLoginWaitResult {
  connected: boolean;
  message: string;
}

interface ChannelsStatusPayload {
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, unknown>;
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

async function collectWhatsAppDebug(params: { gatewayUrl: string; token: string }) {
  const status = await gatewayRpc<ChannelsStatusPayload>({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "channels.status",
    rpcParams: { probe: true, timeoutMs: 8000 },
    timeoutMs: 12_000,
  });
  if (!status.ok) {
    return {
      at: new Date().toISOString(),
      error: status.error ?? "channels.status failed",
    };
  }
  const channel = status.payload?.channels?.whatsapp;
  const accounts = status.payload?.channelAccounts?.whatsapp;
  const account = Array.isArray(accounts) ? (accounts[0] ?? null) : null;
  return {
    at: new Date().toISOString(),
    channel,
    account,
  };
}

function extractLinkedSelfE164(debug: unknown): string | null {
  if (!debug || typeof debug !== "object") {
    return null;
  }
  const channel = (debug as { channel?: unknown }).channel;
  if (!channel || typeof channel !== "object") {
    return null;
  }
  const self = (channel as { self?: unknown }).self;
  if (!self || typeof self !== "object") {
    return null;
  }
  const e164 = (self as { e164?: unknown }).e164;
  if (typeof e164 !== "string") {
    return null;
  }
  const normalized = e164.trim();
  return normalized.length > 0 ? normalized : null;
}

async function enforceOwnerOnlyWhatsAppAccess(params: {
  gatewayUrl: string;
  token: string;
  ownerE164: string;
  accountId: string;
}) {
  const configResult = await gatewayRpc<{ hash?: string; config?: Record<string, unknown> }>({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "config.get",
    rpcParams: {},
    timeoutMs: 10_000,
  });
  if (!configResult.ok || !configResult.payload?.hash) {
    return { ok: false as const, error: configResult.error ?? "Config hash unavailable" };
  }

  const patchResult = await gatewayRpc({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "config.patch",
    rpcParams: {
      baseHash: configResult.payload.hash,
      raw: JSON.stringify({
        channels: {
          whatsapp: {
            accounts: {
              [params.accountId]: {
                dmPolicy: "allowlist",
                allowFrom: [params.ownerE164],
              },
            },
          },
        },
      }),
      restartDelayMs: 1000,
    },
    timeoutMs: 15_000,
  });
  if (!patchResult.ok) {
    return { ok: false as const, error: patchResult.error ?? "Failed to update WhatsApp policy" };
  }
  return { ok: true as const };
}

function extractAccountId(debug: unknown, fallback: string): string {
  if (!debug || typeof debug !== "object") {
    return fallback;
  }
  const account = (debug as { account?: unknown }).account;
  if (!account || typeof account !== "object") {
    return fallback;
  }
  const accountId = (account as { accountId?: unknown }).accountId;
  if (typeof accountId !== "string") {
    return fallback;
  }
  const trimmed = accountId.trim();
  return trimmed.length > 0 ? trimmed : fallback;
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
      const ownerE164 = extractLinkedSelfE164(debug);
      if (ownerE164) {
        const resolvedAccountId = extractAccountId(debug, requestedAccountId);
        const accessResult = await enforceOwnerOnlyWhatsAppAccess({
          gatewayUrl,
          token,
          ownerE164,
          accountId: resolvedAccountId,
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
