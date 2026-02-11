# OpenClaw Core Changes for Billing Integration

These changes need to be applied to the OpenClaw core repo to enable usage tracking for the hosted platform.

## File 1: src/agents/hosted-usage-logger.ts (NEW FILE)

Create this new file:

```typescript
/**
 * Hosted Usage Logger
 *
 * Reports API usage (token counts) to the hosted platform for billing tracking.
 * Only active when INSTANCE_ID and HOSTED_USAGE_REPORT_URL are set.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agent/hosted-usage");

interface UsageEvent {
  instanceId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

interface HostedUsageConfig {
  enabled: boolean;
  instanceId: string;
  reportUrl: string;
  batchSize: number;
  flushIntervalMs: number;
  serviceKey?: string;
}

// Queue of pending events
let pendingEvents: UsageEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let config: HostedUsageConfig | null = null;

/**
 * Resolve configuration from environment variables
 */
function resolveConfig(env: NodeJS.ProcessEnv): HostedUsageConfig {
  const instanceId = env.INSTANCE_ID?.trim();
  const reportUrl = env.HOSTED_USAGE_REPORT_URL?.trim();

  if (!instanceId || !reportUrl) {
    return {
      enabled: false,
      instanceId: "",
      reportUrl: "",
      batchSize: 10,
      flushIntervalMs: 30000,
    };
  }

  return {
    enabled: true,
    instanceId,
    reportUrl,
    batchSize: parseInt(env.HOSTED_USAGE_BATCH_SIZE || "10", 10),
    flushIntervalMs: parseInt(env.HOSTED_USAGE_FLUSH_INTERVAL || "30000", 10),
    serviceKey: env.USAGE_SERVICE_KEY?.trim(),
  };
}

/**
 * Extract usage data from the assistant message
 */
function extractUsageFromMessages(
  messages: AgentMessage[]
): { inputTokens: number; outputTokens: number } | null {
  // Find the last assistant message with usage data
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: unknown; usage?: unknown };
    if (msg?.role === "assistant" && msg.usage && typeof msg.usage === "object") {
      const usage = msg.usage as Record<string, unknown>;
      const inputTokens =
        typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens =
        typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

      // Only return if we have meaningful data
      if (inputTokens > 0 || outputTokens > 0) {
        return { inputTokens, outputTokens };
      }
    }
  }
  return null;
}

/**
 * Flush pending events to the hosted platform
 */
async function flushEvents(): Promise<void> {
  if (!config?.enabled || pendingEvents.length === 0) {
    return;
  }

  const eventsToFlush = [...pendingEvents];
  pendingEvents = [];

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add auth header if service key is available
    if (config.serviceKey) {
      headers.Authorization = `Bearer ${config.serviceKey}`;
    }

    const response = await fetch(config.reportUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: eventsToFlush }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      log.warn(`Failed to report usage events: HTTP ${response.status}`);
      // Re-queue events on failure (with limit)
      if (pendingEvents.length < 1000) {
        pendingEvents = [...eventsToFlush, ...pendingEvents];
      }
      return;
    }

    const result = await response.json();
    log.debug(`Flushed ${eventsToFlush.length} usage events`, result);
  } catch (err) {
    log.warn(`Error reporting usage events: ${err}`);
    // Re-queue on network error
    if (pendingEvents.length < 1000) {
      pendingEvents = [...eventsToFlush, ...pendingEvents];
    }
  }
}

export interface HostedUsageLogger {
  enabled: true;
  recordUsage: (params: {
    messages: AgentMessage[];
    modelId: string;
    provider?: string;
    error?: unknown;
  }) => void;
  flush: () => Promise<void>;
}

/**
 * Create a hosted usage logger instance
 */
export function createHostedUsageLogger(params: {
  env?: NodeJS.ProcessEnv;
}): HostedUsageLogger | null {
  const env = params.env ?? process.env;

  // Lazy initialize config
  if (!config) {
    config = resolveConfig(env);
  }

  if (!config.enabled) {
    return null;
  }

  // Set up periodic flush if not already running
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushEvents();
    }, config.flushIntervalMs);

    // Don't block process exit
    flushTimer.unref();
  }

  log.info("Hosted usage logger enabled", {
    instanceId: config.instanceId,
    reportUrl: config.reportUrl,
  });

  return {
    enabled: true,

    recordUsage: (params) => {
      if (!config?.enabled) return;

      const usage = extractUsageFromMessages(params.messages);
      if (!usage) {
        return;
      }

      const event: UsageEvent = {
        instanceId: config.instanceId,
        modelId: params.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        timestamp: new Date().toISOString(),
      };

      pendingEvents.push(event);

      log.debug("Recorded usage event", {
        modelId: params.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

      // Flush if batch size reached
      if (pendingEvents.length >= config.batchSize) {
        void flushEvents();
      }
    },

    flush: flushEvents,
  };
}

/**
 * Clear the usage logger state (useful for testing)
 */
export function clearHostedUsageLogger(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  pendingEvents = [];
  config = null;
}
```

## File 2: src/agents/pi-embedded-runner/run/attempt.ts (MODIFICATIONS)

### Step 1: Add import at the top of the file

Add this import near the other imports:

```typescript
import { createHostedUsageLogger } from "../../hosted-usage-logger.js";
```

### Step 2: Create the logger instance

After the `anthropicPayloadLogger` initialization (around line 100-110), add:

```typescript
// Hosted usage logger for billing tracking (only active when INSTANCE_ID is set)
const hostedUsageLogger = createHostedUsageLogger({ env: process.env });
```

### Step 3: Record usage after each API call

After line ~814 (after the API call completes and messages are updated), add:

```typescript
// Report usage to hosted platform for billing
hostedUsageLogger?.recordUsage({
  messages: messagesSnapshot,
  modelId: params.modelId,
});
```

## Environment Variables Required

For the hosted usage logger to be active, these env vars must be set in the container:

- `INSTANCE_ID` - The OpenClaw instance UUID
- `HOSTED_USAGE_REPORT_URL` - URL to POST usage events (e.g., `https://your-app.vercel.app/api/usage/events`)
- `USAGE_SERVICE_KEY` (optional) - Auth key for the usage API

These are injected by the EC2 pool manager when starting containers.
