import { gatewayRpc } from "@/lib/gateway/ws-client";

type ChannelsStatusPayload = {
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, unknown>;
};

type GatewayConfigPayload = {
  hash?: string;
  config?: Record<string, unknown>;
};

type EnsureOwnerOnlyParams = {
  gatewayUrl: string;
  token: string;
  fallbackAccountId?: string;
  debug?: unknown;
};

type EnsureOwnerOnlyResult = {
  ok: boolean;
  applied: boolean;
  ownerE164?: string;
  accountId?: string;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function collectWhatsAppDebug(params: {
  gatewayUrl: string;
  token: string;
}): Promise<{ at: string; error: string } | { at: string; channel?: unknown; account?: unknown }> {
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
  const debugObj = asRecord(debug);
  const channel = asRecord(debugObj?.channel);
  const self = asRecord(channel?.self);
  const e164 = typeof self?.e164 === "string" ? self.e164.trim() : "";
  return e164 || null;
}

function extractAccountId(debug: unknown, fallback: string): string {
  const debugObj = asRecord(debug);
  const account = asRecord(debugObj?.account);
  const accountId = typeof account?.accountId === "string" ? account.accountId.trim() : "";
  return accountId || fallback;
}

function needsOwnerAllowlistPatch(params: {
  config: Record<string, unknown> | undefined;
  accountId: string;
  ownerE164: string;
}): boolean {
  const cfg = asRecord(params.config);
  const channels = asRecord(cfg?.channels);
  const whatsapp = asRecord(channels?.whatsapp);
  const accounts = asRecord(whatsapp?.accounts);
  const account = asRecord(accounts?.[params.accountId]);
  const dmPolicy = typeof account?.dmPolicy === "string" ? account.dmPolicy.trim() : "";
  const allowFrom = Array.isArray(account?.allowFrom)
    ? (account.allowFrom
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean))
    : [];
  return !(dmPolicy === "allowlist" && allowFrom.length === 1 && allowFrom[0] === params.ownerE164);
}

export async function ensureOwnerOnlyWhatsAppAccess(
  params: EnsureOwnerOnlyParams,
): Promise<EnsureOwnerOnlyResult> {
  const fallbackAccountId = params.fallbackAccountId?.trim() || "default";
  const ownerE164 = extractLinkedSelfE164(params.debug);
  if (!ownerE164) {
    return { ok: true, applied: false };
  }
  const accountId = extractAccountId(params.debug, fallbackAccountId);

  const configResult = await gatewayRpc<GatewayConfigPayload>({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "config.get",
    rpcParams: {},
    timeoutMs: 10_000,
  });
  if (!configResult.ok || !configResult.payload?.hash) {
    return {
      ok: false,
      applied: false,
      ownerE164,
      accountId,
      error: configResult.error ?? "Config hash unavailable",
    };
  }

  if (
    !needsOwnerAllowlistPatch({
      config: configResult.payload.config,
      accountId,
      ownerE164,
    })
  ) {
    return { ok: true, applied: false, ownerE164, accountId };
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
              [accountId]: {
                dmPolicy: "allowlist",
                allowFrom: [ownerE164],
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
    return {
      ok: false,
      applied: false,
      ownerE164,
      accountId,
      error: patchResult.error ?? "Failed to update WhatsApp policy",
    };
  }
  return { ok: true, applied: true, ownerE164, accountId };
}
