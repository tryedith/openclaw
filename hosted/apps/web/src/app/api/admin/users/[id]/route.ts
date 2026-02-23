import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/admin/users/[id] - User detail with instances, channels, usage
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const admin = createAdminClient();

  const { data: user, error } = await admin
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Get user's instances
  const { data: instances } = await admin
    .from("instances")
    .select("id, name, description, status, public_url, aws_service_arn, created_at, last_health_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  // Get usage summary for this user (current month)
  const { data: usageData } = await admin
    .from("usage_events")
    .select("model_id, input_tokens, output_tokens, cost_usd")
    .eq("user_id", id)
    .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  const usageSummary = {
    totalCostUsd: 0,
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  if (usageData) {
    for (const row of usageData) {
      usageSummary.totalCostUsd += Number(row.cost_usd) || 0;
      usageSummary.totalRequests += 1;
      usageSummary.totalInputTokens += Number(row.input_tokens) || 0;
      usageSummary.totalOutputTokens += Number(row.output_tokens) || 0;
    }
    usageSummary.totalCostUsd = Math.round(usageSummary.totalCostUsd * 1_000_000) / 1_000_000;
  }

  return NextResponse.json({
    user,
    instances: instances || [],
    usage: usageSummary,
  });
}

// PATCH /api/admin/users/[id] - Update subscription tier
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;

  let body: { subscription_tier?: string; subscription_expires_at?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.subscription_tier) {
    if (!["free", "pro", "enterprise"].includes(body.subscription_tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }
    updates.subscription_tier = body.subscription_tier;
  }
  if (body.subscription_expires_at !== undefined) {
    updates.subscription_expires_at = body.subscription_expires_at;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("[admin/users] Update error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }

  await logAdminAction(auth.user.id, "user.update", "user", id, updates);

  return NextResponse.json({ ok: true });
}
