import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";

import type { OpenClawConfig } from "../../config/config.js";
import { log } from "./logger.js";

/**
 * Resolve provider-specific extra params from model config.
 * Used to pass through stream params like temperature/maxTokens.
 *
 * @internal Exported for testing only
 */
export function resolveExtraParams(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
}): Record<string, unknown> | undefined {
  const modelKey = `${params.provider}/${params.modelId}`;
  const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
  return modelConfig?.params ? { ...modelConfig.params } : undefined;
}

type CacheControlTtl = "5m" | "1h";
type CacheRetention = "short" | "long" | "none";

function toCacheRetention(ttl: CacheControlTtl): CacheRetention {
  return ttl === "1h" ? "long" : "short";
}

export function applyAnthropicCacheControlTtl(payload: unknown, ttl: CacheControlTtl): void {
  // Anthropic's explicit "1h" retention must be set on cache breakpoints.
  // For "5m", ephemeral without ttl is sufficient.
  if (ttl !== "1h") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

  const asRecord = payload as Record<string, unknown>;
  const setCacheControl = (block: Record<string, unknown>) => {
    block.cache_control = { type: "ephemeral", ttl: "1h" };
  };

  const system = asRecord.system;
  if (Array.isArray(system)) {
    for (const item of system) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      setCacheControl(item as Record<string, unknown>);
    }
  }

  const messages = asRecord.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object" || Array.isArray(last)) return;

  const lastMessage = last as Record<string, unknown>;
  if (lastMessage.role !== "user") return;

  const content = lastMessage.content;
  if (typeof content === "string") {
    lastMessage.content = [
      { type: "text", text: content, cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    return;
  }
  if (!Array.isArray(content) || content.length === 0) return;

  const lastBlock = content[content.length - 1];
  if (!lastBlock || typeof lastBlock !== "object" || Array.isArray(lastBlock)) return;
  setCacheControl(lastBlock as Record<string, unknown>);
}

function resolveCacheControlTtl(
  extraParams: Record<string, unknown> | undefined,
  provider: string,
  modelId: string,
): CacheControlTtl | undefined {
  const raw = extraParams?.cacheControlTtl;
  if (raw !== "5m" && raw !== "1h") return undefined;
  if (provider === "anthropic") return raw;
  if (provider === "openrouter" && modelId.startsWith("anthropic/")) return raw;
  return undefined;
}

export function resolveCacheRetention(
  extraParams: Record<string, unknown> | undefined,
  provider: string,
  modelId: string,
): CacheRetention | undefined {
  const ttl = resolveCacheControlTtl(extraParams, provider, modelId);
  if (!ttl) return undefined;
  return toCacheRetention(ttl);
}

function createStreamFnWithExtraParams(
  baseStreamFn: StreamFn | undefined,
  extraParams: Record<string, unknown> | undefined,
  provider: string,
  modelId: string,
): StreamFn | undefined {
  if (!extraParams || Object.keys(extraParams).length === 0) {
    return undefined;
  }

  const streamParams: Partial<SimpleStreamOptions> & {
    cacheControlTtl?: CacheControlTtl;
    cacheRetention?: CacheRetention;
  } = {};
  if (typeof extraParams.temperature === "number") {
    streamParams.temperature = extraParams.temperature;
  }
  if (typeof extraParams.maxTokens === "number") {
    streamParams.maxTokens = extraParams.maxTokens;
  }
  const cacheControlTtl = resolveCacheControlTtl(extraParams, provider, modelId);
  if (cacheControlTtl) {
    streamParams.cacheControlTtl = cacheControlTtl;
  }
  const cacheRetention = resolveCacheRetention(extraParams, provider, modelId);
  if (cacheRetention) {
    streamParams.cacheRetention = cacheRetention;
  }

  if (Object.keys(streamParams).length === 0) {
    return undefined;
  }

  log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}`);

  const underlying = baseStreamFn ?? streamSimple;
  const wrappedStreamFn: StreamFn = (model, context, options) => {
    const nextOnPayload = (payload: unknown) => {
      if (cacheControlTtl) {
        applyAnthropicCacheControlTtl(payload, cacheControlTtl);
      }
      options?.onPayload?.(payload);
    };
    return underlying(model as Model<Api>, context, {
      ...streamParams,
      ...options,
      onPayload: nextOnPayload,
    });
  };

  return wrappedStreamFn;
}

/**
 * Apply extra params (like temperature) to an agent's streamFn.
 *
 * @internal Exported for testing
 */
export function applyExtraParamsToAgent(
  agent: { streamFn?: StreamFn },
  cfg: OpenClawConfig | undefined,
  provider: string,
  modelId: string,
  extraParamsOverride?: Record<string, unknown>,
): void {
  const extraParams = resolveExtraParams({
    cfg,
    provider,
    modelId,
  });
  const override =
    extraParamsOverride && Object.keys(extraParamsOverride).length > 0
      ? Object.fromEntries(
          Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined),
        )
      : undefined;
  const merged = Object.assign({}, extraParams, override);
  const wrappedStreamFn = createStreamFnWithExtraParams(agent.streamFn, merged, provider, modelId);

  if (wrappedStreamFn) {
    log.debug(`applying extraParams to agent streamFn for ${provider}/${modelId}`);
    agent.streamFn = wrappedStreamFn;
  }
}
