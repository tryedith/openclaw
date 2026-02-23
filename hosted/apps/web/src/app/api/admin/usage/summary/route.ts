import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/admin/usage/summary - Platform-wide usage summary
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "month";
  const userId = url.searchParams.get("user_id") || null;

  const admin = createAdminClient();

  // Use direct query aggregation (admin client bypasses RLS)
  const validPeriods = ["day", "week", "month", "all"];
  const p = validPeriods.includes(period) ? period : "month";

  let startDate: string;
  const now = new Date();
  if (p === "day") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  } else if (p === "week") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (p === "all") {
    startDate = new Date(0).toISOString();
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  let query = admin
    .from("usage_events")
    .select("model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, user_id")
    .gte("created_at", startDate);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: events, error } = await query;

  if (error) {
    console.error("[admin/usage] Error:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }

  const rows = events || [];
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  const byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number }> = {};
  const byUser: Record<string, number> = {};

  for (const row of rows) {
    const cost = Number(row.cost_usd) || 0;
    totalCostUsd += cost;
    totalInputTokens += Number(row.input_tokens) || 0;
    totalOutputTokens += Number(row.output_tokens) || 0;
    totalCacheReadTokens += Number(row.cache_read_tokens) || 0;
    totalCacheWriteTokens += Number(row.cache_write_tokens) || 0;

    const model = row.model_id || "unknown";
    if (!byModel[model]) {
      byModel[model] = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    byModel[model].requests += 1;
    byModel[model].inputTokens += Number(row.input_tokens) || 0;
    byModel[model].outputTokens += Number(row.output_tokens) || 0;
    byModel[model].costUsd += cost;

    byUser[row.user_id] = (byUser[row.user_id] || 0) + cost;
  }

  // Round costs
  totalCostUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;
  for (const model of Object.keys(byModel)) {
    byModel[model].costUsd = Math.round(byModel[model].costUsd * 1_000_000) / 1_000_000;
  }

  // Top users by cost
  const topUsers = Object.entries(byUser)
    .map(([uid, cost]) => ({ userId: uid, costUsd: Math.round(cost * 1_000_000) / 1_000_000 }))
    .toSorted((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);

  return NextResponse.json({
    period: p,
    startDate,
    endDate: now.toISOString(),
    totalCostUsd,
    totalRequests: rows.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    byModel,
    topUsers,
  });
}
