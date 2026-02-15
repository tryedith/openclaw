import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

interface ModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  promptTokens: number;
  totalTokens: number;
  costUsd: number;
}

interface UsageSummary {
  period: string;
  startDate: string;
  endDate: string;
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalPromptTokens: number;
  totalTokens: number;
  byModel: Record<string, ModelUsage>;
}

type UsagePeriod = "day" | "week" | "month" | "all";

type UsageSummaryRow = {
  period: string;
  start_date: string;
  end_date: string;
  total_cost_usd: number | string | null;
  total_requests: number | string | null;
  total_input_tokens: number | string | null;
  total_output_tokens: number | string | null;
  total_cache_read_tokens: number | string | null;
  total_cache_write_tokens: number | string | null;
  total_prompt_tokens: number | string | null;
  by_model: unknown;
};

const VALID_PERIODS: ReadonlySet<UsagePeriod> = new Set([
  "day",
  "week",
  "month",
  "all",
]);

const UUID_V4_OR_V1_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeByModel(raw: unknown): Record<string, ModelUsage> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const byModelRaw = raw as Record<string, unknown>;
  const normalized: Record<string, ModelUsage> = {};

  for (const [modelId, value] of Object.entries(byModelRaw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    normalized[modelId] = {
      requests: Math.trunc(toNumber(entry.requests)),
      inputTokens: Math.trunc(toNumber(entry.inputTokens)),
      outputTokens: Math.trunc(toNumber(entry.outputTokens)),
      cacheReadTokens: Math.trunc(toNumber(entry.cacheReadTokens)),
      cacheWriteTokens: Math.trunc(toNumber(entry.cacheWriteTokens)),
      promptTokens: Math.trunc(toNumber(entry.promptTokens)),
      totalTokens: Math.trunc(toNumber(entry.totalTokens)),
      costUsd: Math.round(toNumber(entry.costUsd) * 1_000_000) / 1_000_000,
    };
  }

  return normalized;
}

// GET /api/usage/summary - Get usage summary for authenticated user
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse query params
  const url = new URL(request.url);
  const requestedPeriod = url.searchParams.get("period")?.toLowerCase();
  const period: UsagePeriod =
    requestedPeriod && VALID_PERIODS.has(requestedPeriod as UsagePeriod)
      ? (requestedPeriod as UsagePeriod)
      : "month";
  const instanceId = url.searchParams.get("instance_id");

  if (instanceId && !UUID_V4_OR_V1_REGEX.test(instanceId)) {
    return NextResponse.json(
      { error: "Invalid instance_id format" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .rpc("get_usage_summary", {
      p_period: period,
      p_instance_id: instanceId ?? null,
    })
    .single<UsageSummaryRow>();

  if (error) {
    console.error("[usage/summary] RPC error:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage" },
      { status: 500 }
    );
  }

  const summary: UsageSummary = {
    period: data?.period || period,
    startDate: data?.start_date || new Date(0).toISOString(),
    endDate: data?.end_date || new Date().toISOString(),
    totalCostUsd: Math.round(toNumber(data?.total_cost_usd) * 1_000_000) / 1_000_000,
    totalRequests: Math.trunc(toNumber(data?.total_requests)),
    totalInputTokens: Math.trunc(toNumber(data?.total_input_tokens)),
    totalOutputTokens: Math.trunc(toNumber(data?.total_output_tokens)),
    totalCacheReadTokens: Math.trunc(toNumber(data?.total_cache_read_tokens)),
    totalCacheWriteTokens: Math.trunc(toNumber(data?.total_cache_write_tokens)),
    totalPromptTokens: Math.trunc(toNumber(data?.total_prompt_tokens)),
    totalTokens:
      Math.trunc(toNumber(data?.total_prompt_tokens)) +
      Math.trunc(toNumber(data?.total_output_tokens)),
    byModel: normalizeByModel(data?.by_model),
  };

  return NextResponse.json(summary);
}
