import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { createSubsystemLogger } from "../logging/subsystem.js";

import { hasNonzeroUsage, normalizeUsage, type UsageLike } from "./usage.js";

const log = createSubsystemLogger("agent/hosted-usage");

type UsageEvent = {
  instanceId: string;
  modelId: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
  timestamp: string;
};

type PendingUsageEvent = Omit<UsageEvent, "instanceId">;

type HostedUsageConfig = {
  enabled: boolean;
  instanceId: string | null;
  reportUrl: string;
  batchSize: number;
  flushIntervalMs: number;
  serviceKey?: string;
  instanceLookupInFlight?: Promise<string | null>;
  warnedMissingInstanceId: boolean;
};

export type HostedUsageLogger = {
  enabled: true;
  recordUsage: (params: {
    messages: AgentMessage[];
    modelId: string;
    provider?: string;
    modelCost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    error?: unknown;
  }) => void;
  flush: () => Promise<void>;
};

let pendingEvents: PendingUsageEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight: Promise<void> | null = null;
let config: HostedUsageConfig | null = null;
let didLogEnabled = false;

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const MAX_PENDING_EVENTS = 1_000;
const IMDS_TOKEN_URL = "http://169.254.169.254/latest/api/token";
const IMDS_TAG_URL = "http://169.254.169.254/latest/meta-data/tags/instance/OpenClawInstanceId";
const IMDS_TIMEOUT_MS = 1_500;
const IMDS_TOKEN_TTL_SECONDS = 60;

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveConfig(env: NodeJS.ProcessEnv): HostedUsageConfig {
  const instanceId = env.INSTANCE_ID?.trim();
  const reportUrl = env.HOSTED_USAGE_REPORT_URL?.trim();

  if (!reportUrl) {
    return {
      enabled: false,
      instanceId: null,
      reportUrl: "",
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      warnedMissingInstanceId: false,
    };
  }

  return {
    enabled: true,
    instanceId: instanceId || null,
    reportUrl,
    batchSize: parsePositiveInteger(env.HOSTED_USAGE_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    flushIntervalMs: parsePositiveInteger(
      env.HOSTED_USAGE_FLUSH_INTERVAL,
      DEFAULT_FLUSH_INTERVAL_MS,
    ),
    serviceKey: env.USAGE_SERVICE_KEY?.trim(),
    warnedMissingInstanceId: false,
  };
}

function extractUsageFromMessages(messages: AgentMessage[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} | null {
  if (messages.length === 0) return null;

  // Only consider the newest message to avoid replaying stale usage from previous turns.
  const latest = messages[messages.length - 1] as { role?: unknown; usage?: unknown };
  if (latest?.role !== "assistant" || !latest.usage || typeof latest.usage !== "object") {
    return null;
  }

  const usage = normalizeUsage(latest.usage as UsageLike);
  if (!hasNonzeroUsage(usage)) return null;

  const inputTokens = usage.input ?? 0;
  const outputTokens = usage.output ?? 0;
  const cacheReadTokens = usage.cacheRead ?? 0;
  const cacheWriteTokens = usage.cacheWrite ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function asFiniteNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function normalizeModelCost(raw?: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): {
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
} {
  if (!raw) return {};
  return {
    inputPricePerMillion: asFiniteNonNegativeNumber(raw.input),
    outputPricePerMillion: asFiniteNonNegativeNumber(raw.output),
    cacheReadPricePerMillion: asFiniteNonNegativeNumber(raw.cacheRead),
    cacheWritePricePerMillion: asFiniteNonNegativeNumber(raw.cacheWrite),
  };
}

function prependWithCap(items: PendingUsageEvent[]): void {
  if (items.length === 0) return;
  pendingEvents = [...items, ...pendingEvents].slice(0, MAX_PENDING_EVENTS);
}

function pushWithCap(event: PendingUsageEvent): void {
  pendingEvents.push(event);
  if (pendingEvents.length > MAX_PENDING_EVENTS) {
    pendingEvents = pendingEvents.slice(-MAX_PENDING_EVENTS);
  }
}

async function fetchInstanceIdFromImds(): Promise<string | null> {
  try {
    // IMDSv2: acquire session token first (required when http_tokens = "required")
    const tokenResponse = await fetch(IMDS_TOKEN_URL, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": String(IMDS_TOKEN_TTL_SECONDS) },
      signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) return null;
    const imdsToken = (await tokenResponse.text()).trim();
    if (!imdsToken) return null;

    // IMDSv2: fetch tag with session token
    const response = await fetch(IMDS_TAG_URL, {
      method: "GET",
      headers: { "X-aws-ec2-metadata-token": imdsToken },
      signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const value = (await response.text()).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function resolveInstanceId(): Promise<string | null> {
  if (!config?.enabled) return null;
  if (config.instanceId) return config.instanceId;
  if (config.instanceLookupInFlight) {
    return await config.instanceLookupInFlight;
  }

  const lookupPromise = fetchInstanceIdFromImds()
    .then((instanceId) => {
      if (!config?.enabled) return null;
      if (instanceId) {
        config.instanceId = instanceId;
        log.info("Resolved hosted instance ID from EC2 metadata tag", {
          instanceId,
        });
        return instanceId;
      }

      if (!config.warnedMissingInstanceId) {
        log.warn(
          "Missing hosted instance ID; set INSTANCE_ID or enable EC2 metadata tags for OpenClawInstanceId",
        );
        config.warnedMissingInstanceId = true;
      }
      return null;
    })
    .finally(() => {
      if (config) {
        config.instanceLookupInFlight = undefined;
      }
    });

  config.instanceLookupInFlight = lookupPromise;
  return await lookupPromise;
}

async function flushEvents(): Promise<void> {
  if (!config?.enabled || pendingEvents.length === 0) return;

  const instanceId = await resolveInstanceId();
  if (!instanceId) return;

  const bufferedEvents = pendingEvents.slice();
  pendingEvents = [];

  const eventsToFlush: UsageEvent[] = bufferedEvents.map((event) => ({
    instanceId,
    modelId: event.modelId,
    provider: event.provider,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    inputPricePerMillion: event.inputPricePerMillion,
    outputPricePerMillion: event.outputPricePerMillion,
    cacheReadPricePerMillion: event.cacheReadPricePerMillion,
    cacheWritePricePerMillion: event.cacheWritePricePerMillion,
    timestamp: event.timestamp,
  }));

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.serviceKey) {
      headers.Authorization = `Bearer ${config.serviceKey}`;
    }

    const response = await fetch(config.reportUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: eventsToFlush }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn(`Failed to report usage events: HTTP ${response.status}`);
      prependWithCap(bufferedEvents);
      return;
    }

    let result: unknown = undefined;
    try {
      result = await response.json();
    } catch {
      // Ignore empty or non-JSON responses from the hosted endpoint.
    }
    const payload =
      result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
    log.debug(`Flushed ${eventsToFlush.length} usage events`, payload);
  } catch (err) {
    log.warn(`Error reporting usage events: ${String(err)}`);
    prependWithCap(bufferedEvents);
  }
}

function queueFlush(): Promise<void> {
  if (!config?.enabled || pendingEvents.length === 0) return Promise.resolve();
  if (flushInFlight) return flushInFlight;

  flushInFlight = flushEvents().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

export function createHostedUsageLogger(params: {
  env?: NodeJS.ProcessEnv;
}): HostedUsageLogger | null {
  const env = params.env ?? process.env;
  if (!config) {
    config = resolveConfig(env);
  }
  if (!config.enabled) return null;

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void queueFlush();
    }, config.flushIntervalMs);
    flushTimer.unref();
  }

  if (!didLogEnabled) {
    log.info("Hosted usage logger enabled", {
      instanceId: config.instanceId ?? "(will resolve from EC2 metadata tag)",
      reportUrl: config.reportUrl,
      batchSize: config.batchSize,
      flushIntervalMs: config.flushIntervalMs,
    });
    didLogEnabled = true;
  }

  return {
    enabled: true,
    recordUsage: (params) => {
      if (!config?.enabled) return;
      const usage = extractUsageFromMessages(params.messages);
      if (!usage) return;
      const normalizedModelCost = normalizeModelCost(params.modelCost);

      pushWithCap({
        modelId: params.modelId,
        provider: params.provider?.trim() || undefined,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        inputPricePerMillion: normalizedModelCost.inputPricePerMillion,
        outputPricePerMillion: normalizedModelCost.outputPricePerMillion,
        cacheReadPricePerMillion: normalizedModelCost.cacheReadPricePerMillion,
        cacheWritePricePerMillion: normalizedModelCost.cacheWritePricePerMillion,
        timestamp: new Date().toISOString(),
      });

      log.debug("Recorded usage event", {
        provider: params.provider,
        modelId: params.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        inputPricePerMillion: normalizedModelCost.inputPricePerMillion,
        outputPricePerMillion: normalizedModelCost.outputPricePerMillion,
        cacheReadPricePerMillion: normalizedModelCost.cacheReadPricePerMillion,
        cacheWritePricePerMillion: normalizedModelCost.cacheWritePricePerMillion,
      });

      if (pendingEvents.length >= config.batchSize) {
        void queueFlush();
      }
    },
    flush: queueFlush,
  };
}

export function clearHostedUsageLogger(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  pendingEvents = [];
  flushInFlight = null;
  config = null;
  didLogEnabled = false;
}
