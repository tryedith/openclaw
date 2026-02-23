import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/admin/users - List all users with instance counts
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  const admin = createAdminClient();

  let query = admin
    .from("users")
    .select("id, email, display_name, avatar_url, subscription_tier, subscription_expires_at, created_at, instances(id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike("email", `%${search}%`);
  }

  const { data: users, error, count } = await query;

  if (error) {
    console.error("[admin/users] Error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  // Get per-user usage cost for current month
  const userIds = (users || []).map((u) => u.id);
  let usageByCost: Record<string, number> = {};

  if (userIds.length > 0) {
    const { data: usageData } = await admin
      .from("usage_events")
      .select("user_id, cost_usd")
      .in("user_id", userIds)
      .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

    if (usageData) {
      usageByCost = usageData.reduce<Record<string, number>>((acc, row) => {
        acc[row.user_id] = (acc[row.user_id] || 0) + (Number(row.cost_usd) || 0);
        return acc;
      }, {});
    }
  }

  const enriched = (users || []).map((u) => ({
    ...u,
    instance_count: Array.isArray(u.instances) ? u.instances.length : 0,
    monthly_cost_usd: Math.round((usageByCost[u.id] || 0) * 1_000_000) / 1_000_000,
    instances: undefined,
  }));

  return NextResponse.json({
    users: enriched,
    total: count ?? 0,
    page,
    limit,
  });
}
