import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

interface WebLoginStartResult {
  qrDataUrl?: string;
  message: string;
}

interface ChannelsStatusPayload {
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, unknown>;
}

interface GatewayConfigPayload {
  hash?: string;
  config?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function resolvePluginAllowlistWithWhatsApp(config: Record<string, unknown> | undefined): string[] | null {
  if (!isRecord(config)) {
    return null;
  }
  const plugins = config.plugins;
  if (!isRecord(plugins)) {
    return null;
  }
  const rawAllow = plugins.allow;
  if (!Array.isArray(rawAllow)) {
    return null;
  }
  const allow = rawAllow
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => Boolean(entry));
  if (allow.includes("whatsapp")) {
    return allow;
  }
  return [...allow, "whatsapp"];
}

function shouldBootstrapWhatsAppPlugin(error?: string): boolean {
  const message = String(error ?? "").toLowerCase();
  return (
    message.includes("web login provider is not available") ||
    message.includes("method not available") ||
    message.includes("unknown method")
  );
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGatewayReady(params: { gatewayUrl: string; token: string; timeoutMs: number }) {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const probe = await gatewayRpc<{ hash?: string }>({
      gatewayUrl: params.gatewayUrl,
      token: params.token,
      method: "config.get",
      rpcParams: {},
      timeoutMs: 5000,
    });
    if (probe.ok) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function enableWhatsAppPlugin(params: { gatewayUrl: string; token: string }) {
  const configResult = await gatewayRpc<GatewayConfigPayload>({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "config.get",
    rpcParams: {},
    timeoutMs: 10000,
  });
  if (!configResult.ok || !configResult.payload?.hash) {
    return { ok: false as const, error: configResult.error ?? "Config hash unavailable" };
  }

  const allow = resolvePluginAllowlistWithWhatsApp(configResult.payload.config);
  const patch: Record<string, unknown> = {
    plugins: {
      entries: {
        whatsapp: {
          enabled: true,
        },
      },
      ...(allow ? { allow } : {}),
    },
  };

  const patchResult = await gatewayRpc({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "config.patch",
    rpcParams: {
      baseHash: configResult.payload.hash,
      raw: JSON.stringify(patch),
      restartDelayMs: 1000,
    },
    timeoutMs: 15000,
  });
  if (!patchResult.ok) {
    return { ok: false as const, error: patchResult.error ?? "Failed to patch config" };
  }

  const ready = await waitForGatewayReady({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    timeoutMs: 25000,
  });
  if (!ready) {
    return { ok: false as const, error: "Gateway is restarting, please retry in a few seconds." };
  }

  return { ok: true as const };
}

// POST /api/instances/[id]/channels/[channel]/login/start
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
    force?: boolean;
    timeoutMs?: number;
    accountId?: string;
  };

  try {
    let result = await gatewayRpc<WebLoginStartResult>({
      gatewayUrl,
      token,
      method: "web.login.start",
      rpcParams: {
        force: body.force === true,
        timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
        accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      },
      timeoutMs: 45_000,
    });

    if (!result.ok && shouldBootstrapWhatsAppPlugin(result.error)) {
      const bootstrap = await enableWhatsAppPlugin({ gatewayUrl, token });
      if (bootstrap.ok) {
        result = await gatewayRpc<WebLoginStartResult>({
          gatewayUrl,
          token,
          method: "web.login.start",
          rpcParams: {
            force: body.force === true,
            timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
            accountId: typeof body.accountId === "string" ? body.accountId : undefined,
          },
          timeoutMs: 45_000,
        });
      } else {
        const debug = await collectWhatsAppDebug({ gatewayUrl, token });
        return NextResponse.json(
          { error: "Failed to start WhatsApp login", details: bootstrap.error, debug },
          { status: 500 }
        );
      }
    }

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
        { error: "Failed to start WhatsApp login", details: result.error, debug },
        { status: 500 }
      );
    }

    const debug = await collectWhatsAppDebug({ gatewayUrl, token });
    return NextResponse.json({
      ok: true,
      qrDataUrl: result.payload?.qrDataUrl,
      message: result.payload?.message ?? "Scan the QR in WhatsApp.",
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
