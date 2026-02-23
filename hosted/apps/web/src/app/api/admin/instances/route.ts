import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/admin/instances - List all instances across all users
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const search = url.searchParams.get("search") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  const admin = createAdminClient();

  let query = admin
    .from("instances")
    .select("id, name, description, status, public_url, aws_service_arn, created_at, updated_at, last_health_at, user_id, users(email, display_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && ["pending", "provisioning", "running", "stopped", "error"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: instances, error, count } = await query;

  if (error) {
    console.error("[admin/instances] Error:", error);
    return NextResponse.json({ error: "Failed to fetch instances" }, { status: 500 });
  }

  let filtered = instances || [];

  // Filter by user email in JS (Supabase !inner with ilike on related table can be unreliable)
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter((inst) => {
      const email = (inst.users as unknown as { email: string })?.email || "";
      return email.toLowerCase().includes(searchLower);
    });
  }

  const enriched = filtered.map((inst) => ({
    ...inst,
    user_email: (inst.users as unknown as { email: string })?.email,
    user_display_name: (inst.users as unknown as { display_name: string })?.display_name,
    users: undefined,
  }));

  return NextResponse.json({
    instances: enriched,
    total: count ?? 0,
    page,
    limit,
  });
}
