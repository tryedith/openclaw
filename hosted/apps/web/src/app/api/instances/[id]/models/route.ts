import { createClient } from "@/lib/supabase/server";
import { buildSessionKey, gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";
import { NextResponse } from "next/server";

type SupportedProvider = "anthropic" | "openai" | "google";

type GatewayModel = {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  contextWindow?: unknown;
  reasoning?: unknown;
  input?: unknown;
};

type GatewayModelsPayload = {
  models?: GatewayModel[];
};

type GatewayConfigPayload = {
  hash?: string;
  config?: Record<string, unknown>;
};

const SUPPORTED_PROVIDERS: readonly SupportedProvider[] = [
  "anthropic",
  "openai",
  "google",
] as const;

const DEFAULT_MODEL_REF = "anthropic/claude-opus-4-5";

const PROVIDER_LABELS: Record<SupportedProvider, string> = {
  anthropic: "Claude",
  openai: "GPT",
  google: "Gemini",
};

function normalizeProvider(raw: unknown): SupportedProvider | null {
  if (typeof raw !== "string") {return null;}
  const normalized = raw.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(normalized as SupportedProvider)) {return null;}
  return normalized as SupportedProvider;
}

function normalizeModelRef(raw: string): { provider: SupportedProvider; model: string } | null {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {return null;}
  const provider = normalizeProvider(trimmed.slice(0, slash));
  if (!provider) {return null;}
  const model = trimmed.slice(slash + 1).trim();
  if (!model) {return null;}
  return { provider, model };
}

function readCurrentPrimaryModelRef(config: Record<string, unknown> | undefined): string {
  const agents = config?.agents;
  if (!agents || typeof agents !== "object") {return DEFAULT_MODEL_REF;}
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object") {return DEFAULT_MODEL_REF;}
  const model = (defaults as Record<string, unknown>).model;
  if (!model || typeof model !== "object") {return DEFAULT_MODEL_REF;}
  const primary = (model as Record<string, unknown>).primary;
  if (typeof primary !== "string" || !primary.trim()) {return DEFAULT_MODEL_REF;}
  return primary.trim();
}

function readHasAllowlist(config: Record<string, unknown> | undefined): boolean {
  const agents = config?.agents;
  if (!agents || typeof agents !== "object") {return false;}
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object") {return false;}
  const models = (defaults as Record<string, unknown>).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {return false;}
  return Object.keys(models).length > 0;
}

function formatModelResponse(models: GatewayModel[]) {
  const grouped = new Map<SupportedProvider, Array<Record<string, unknown>>>();
  for (const provider of SUPPORTED_PROVIDERS) {grouped.set(provider, []);}

  for (const entry of models) {
    const provider = normalizeProvider(entry.provider);
    if (!provider) {continue;}

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {continue;}

    const providerModels = grouped.get(provider)!;
    providerModels.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
      modelRef: `${provider}/${id}`,
      contextWindow:
        typeof entry.contextWindow === "number" && Number.isFinite(entry.contextWindow)
          ? entry.contextWindow
          : undefined,
      reasoning: typeof entry.reasoning === "boolean" ? entry.reasoning : undefined,
      input: Array.isArray(entry.input) ? entry.input : undefined,
    });
  }

  return SUPPORTED_PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    models: (grouped.get(provider) ?? []).toSorted((a, b) => {
      const nameA = typeof a.name === "string" ? a.name : "";
      const nameB = typeof b.name === "string" ? b.name : "";
      return nameA.localeCompare(nameB);
    }),
  })).filter((group) => group.models.length > 0);
}

async function resolveInstanceForUser(params: { id: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };}

  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return { error: NextResponse.json({ error: "Instance not found" }, { status: 404 }) };
  }

  if (!instance.public_url || instance.status !== "running") {
    return { error: NextResponse.json({ error: "Instance not ready" }, { status: 400 }) };
  }

  let gatewayUrl: string;
  let token: string;
  try {
    const resolved = resolveGatewayTarget({
      instancePublicUrl: instance.public_url,
      instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
      instanceId: params.id,
    });
    gatewayUrl = resolved.gatewayUrl;
    token = resolved.token;
  } catch (error) {
    console.error("[models] Failed to resolve gateway target:", error);
    return {
      error: NextResponse.json(
        { error: "Failed to resolve gateway credentials", details: String(error) },
        { status: 500 }
      ),
    };
  }

  return { user, instance, gatewayUrl, token };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resolved = await resolveInstanceForUser({ id });
  if ("error" in resolved) {return resolved.error;}

  const [modelsResult, configResult] = await Promise.all([
    gatewayRpc<GatewayModelsPayload>({
      gatewayUrl: resolved.gatewayUrl,
      token: resolved.token,
      method: "models.list",
      rpcParams: {},
    }),
    gatewayRpc<GatewayConfigPayload>({
      gatewayUrl: resolved.gatewayUrl,
      token: resolved.token,
      method: "config.get",
      rpcParams: {},
    }),
  ]);

  if (!modelsResult.ok) {
    return NextResponse.json(
      { error: "Failed to load models", details: modelsResult.error },
      { status: 502 }
    );
  }
  if (!configResult.ok) {
    return NextResponse.json(
      { error: "Failed to load config", details: configResult.error },
      { status: 502 }
    );
  }

  const groups = formatModelResponse(modelsResult.payload?.models ?? []);
  const currentModelRef = readCurrentPrimaryModelRef(configResult.payload?.config);

  return NextResponse.json({
    ok: true,
    currentModelRef,
    providers: groups,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resolved = await resolveInstanceForUser({ id });
  if ("error" in resolved) {return resolved.error;}

  let body: { modelRef?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.modelRef || typeof body.modelRef !== "string") {
    return NextResponse.json({ error: "modelRef is required" }, { status: 400 });
  }

  const parsed = normalizeModelRef(body.modelRef);
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid modelRef. Use provider/model (anthropic|openai|google)." },
      { status: 400 }
    );
  }
  const normalizedModelRef = `${parsed.provider}/${parsed.model}`;

  const modelsResult = await gatewayRpc<GatewayModelsPayload>({
    gatewayUrl: resolved.gatewayUrl,
    token: resolved.token,
    method: "models.list",
    rpcParams: {},
  });
  if (!modelsResult.ok) {
    return NextResponse.json(
      { error: "Failed to load models", details: modelsResult.error },
      { status: 502 }
    );
  }

  const availableRefs = new Set(
    (modelsResult.payload?.models ?? [])
      .map((entry) => {
        const provider = normalizeProvider(entry.provider);
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        return provider && id ? `${provider}/${id}` : null;
      })
      .filter((ref): ref is string => Boolean(ref))
  );

  if (!availableRefs.has(normalizedModelRef)) {
    return NextResponse.json(
      {
        error: "Model not available on this instance",
        modelRef: normalizedModelRef,
      },
      { status: 400 }
    );
  }

  // Immediate effect for active chat session (no restart required).
  const sessionKey = buildSessionKey(resolved.user.id);
  const sessionPatchResult = await gatewayRpc({
    gatewayUrl: resolved.gatewayUrl,
    token: resolved.token,
    method: "sessions.patch",
    rpcParams: {
      key: sessionKey,
      model: normalizedModelRef,
    },
  });

  const configResult = await gatewayRpc<GatewayConfigPayload>({
    gatewayUrl: resolved.gatewayUrl,
    token: resolved.token,
    method: "config.get",
    rpcParams: {},
  });
  if (!configResult.ok || !configResult.payload?.hash) {
    return NextResponse.json(
      { error: "Failed to load config", details: configResult.error ?? "Config hash unavailable" },
      { status: 502 }
    );
  }

  const includeAllowlistEntry = readHasAllowlist(configResult.payload.config);
  const patch: Record<string, unknown> = {
    agents: {
      defaults: {
        model: {
          primary: normalizedModelRef,
        },
        ...(includeAllowlistEntry
          ? {
              models: {
                [normalizedModelRef]: {},
              },
            }
          : {}),
      },
    },
  };

  const configPatchResult = await gatewayRpc<{
    restart?: { scheduled?: boolean; pid?: number };
  }>({
    gatewayUrl: resolved.gatewayUrl,
    token: resolved.token,
    method: "config.patch",
    rpcParams: {
      baseHash: configResult.payload.hash,
      raw: JSON.stringify(patch),
      restartDelayMs: 1000,
    },
  });

  if (!configPatchResult.ok) {
    return NextResponse.json(
      { error: "Failed to persist model selection", details: configPatchResult.error },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    modelRef: normalizedModelRef,
    sessionPatched: sessionPatchResult.ok,
    restart: configPatchResult.payload?.restart,
  });
}
