import { createAdminClient } from "@/lib/supabase/admin";
import { getPricingForModel } from "@/lib/billing/pricing";
import { NextResponse } from "next/server";

interface UsageEvent {
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
  timestamp?: string;
}

type SupportedProvider = "anthropic" | "openai" | "google";

function normalizeEventTimestamp(raw?: string): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) return undefined;
  return new Date(millis).toISOString();
}

function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.trunc(value);
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

function normalizeProvider(raw?: string): SupportedProvider | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "anthropic") return "anthropic";
  if (normalized === "openai") return "openai";
  if (normalized === "google") return "google";
  return null;
}

function inferProviderFromModelId(modelId: string): SupportedProvider {
  const trimmed = modelId.trim().toLowerCase();
  if (trimmed.startsWith("anthropic/") || trimmed.startsWith("claude-")) return "anthropic";
  if (trimmed.startsWith("openai/") || trimmed.startsWith("gpt-") || trimmed.startsWith("o1")) {
    return "openai";
  }
  if (trimmed.startsWith("google/") || trimmed.startsWith("gemini-")) return "google";
  return "anthropic";
}

function normalizeModelIdentity(event: UsageEvent): {
  provider: SupportedProvider;
  modelId: string;
  modelRef: string;
} {
  const rawModelId = event.modelId.trim();
  const slash = rawModelId.indexOf("/");
  const providerFromModel = slash > 0 ? normalizeProvider(rawModelId.slice(0, slash)) : null;
  const modelPart = slash > 0 ? rawModelId.slice(slash + 1).trim() : rawModelId;

  const provider = normalizeProvider(event.provider) ?? providerFromModel ?? inferProviderFromModelId(rawModelId);
  const modelId = modelPart.length > 0 ? modelPart : rawModelId;
  return {
    provider,
    modelId,
    modelRef: `${provider}/${modelId}`,
  };
}

// POST /api/usage/events - Receive usage events from gateway containers
export async function POST(request: Request) {
  // Authenticate using service key (not user auth)
  // This endpoint is called by gateway containers, not users
  const authHeader = request.headers.get("Authorization");
  const serviceKey = process.env.USAGE_SERVICE_KEY;

  if (!serviceKey) {
    console.error("[usage/events] USAGE_SERVICE_KEY not configured");
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 500 }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { events?: UsageEvent[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = body.events;
  if (!events || !Array.isArray(events)) {
    return NextResponse.json(
      { error: "Missing or invalid events array" },
      { status: 400 }
    );
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let supabase: ReturnType<typeof createAdminClient> | null = null;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error("[usage/events] Supabase admin client init failed:", err);
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 500 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 500 }
    );
  }
  let processed = 0;
  let errors = 0;

  for (const event of events) {
    // Validate required fields
    if (
      !event.instanceId ||
      !event.modelId ||
      typeof event.inputTokens !== "number" ||
      typeof event.outputTokens !== "number"
    ) {
      console.warn("[usage/events] Invalid event:", event);
      errors++;
      continue;
    }

    try {
      // Look up user from instance
      const { data: instance, error: lookupError } = await supabase
        .from("instances")
        .select("user_id")
        .eq("id", event.instanceId)
        .single();

      if (lookupError || !instance) {
        console.warn(
          `[usage/events] Instance not found: ${event.instanceId}`,
          lookupError
        );
        errors++;
        continue;
      }

      const normalizedModel = normalizeModelIdentity(event);
      const inputTokens = toNonNegativeInteger(event.inputTokens);
      const outputTokens = toNonNegativeInteger(event.outputTokens);
      const cacheReadTokens = toNonNegativeInteger(event.cacheReadTokens ?? 0) ?? 0;
      const cacheWriteTokens = toNonNegativeInteger(event.cacheWriteTokens ?? 0) ?? 0;
      if (inputTokens == null || outputTokens == null) {
        console.warn("[usage/events] Invalid token values:", event);
        errors++;
        continue;
      }

      const eventInputPrice = toNonNegativeNumber(event.inputPricePerMillion);
      const eventOutputPrice = toNonNegativeNumber(event.outputPricePerMillion);
      const eventCacheReadPrice = toNonNegativeNumber(event.cacheReadPricePerMillion);
      const eventCacheWritePrice = toNonNegativeNumber(event.cacheWritePricePerMillion);

      const fallbackPricing =
        eventInputPrice === undefined ||
        eventOutputPrice === undefined ||
        eventCacheReadPrice === undefined ||
        eventCacheWritePrice === undefined
          ? await getPricingForModel(normalizedModel.modelRef)
          : null;

      const inputPricePerMillion = eventInputPrice ?? fallbackPricing?.input ?? 0;
      const outputPricePerMillion = eventOutputPrice ?? fallbackPricing?.output ?? 0;
      const cacheReadPricePerMillion = eventCacheReadPrice ?? fallbackPricing?.cacheRead ?? inputPricePerMillion;
      const cacheWritePricePerMillion =
        eventCacheWritePrice ?? fallbackPricing?.cacheWrite ?? inputPricePerMillion;

      // usage_events stores a single input token bucket. We fold cache token buckets into an
      // effective input price so generated cost_usd remains close to provider billing.
      const promptSideTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
      const effectiveInputPricePerMillion =
        promptSideTokens > 0
          ? (inputTokens * inputPricePerMillion +
              cacheReadTokens * cacheReadPricePerMillion +
              cacheWriteTokens * cacheWritePricePerMillion) /
            promptSideTokens
          : inputPricePerMillion;

      // Insert usage event
      // Note: cost_usd is a GENERATED column, so we don't include it
      const createdAt = normalizeEventTimestamp(event.timestamp);
      const { error: insertError } = await supabase
        .from("usage_events")
        .insert({
          instance_id: event.instanceId,
          user_id: instance.user_id,
          model_id: normalizedModel.modelRef,
          input_tokens: promptSideTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_tokens: cacheWriteTokens,
          input_price_per_million: effectiveInputPricePerMillion,
          output_price_per_million: outputPricePerMillion,
          ...(createdAt ? { created_at: createdAt } : {}),
        });

      if (insertError) {
        console.error("[usage/events] Insert error:", insertError);
        errors++;
        continue;
      }

      processed++;
    } catch (err) {
      console.error("[usage/events] Processing error:", err);
      errors++;
    }
  }

  console.log(
    `[usage/events] Processed ${processed} events, ${errors} errors`
  );

  return NextResponse.json({
    ok: true,
    processed,
    errors,
    total: events.length,
  });
}
