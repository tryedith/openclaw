import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/admin/audit-log - Paginated audit log
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;
  const action = url.searchParams.get("action") || "";

  const admin = createAdminClient();

  let query = admin
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) {
    query = query.eq("action", action);
  }

  const { data: entries, error, count } = await query;

  if (error) {
    console.error("[admin/audit-log] Error:", error);
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  // Enrich with admin email
  const adminIds = [...new Set((entries || []).map((e) => e.admin_user_id))];
  let adminEmails: Record<string, string> = {};

  if (adminIds.length > 0) {
    const { data: admins } = await admin
      .from("users")
      .select("id, email")
      .in("id", adminIds);

    if (admins) {
      adminEmails = admins.reduce<Record<string, string>>((acc, a) => {
        acc[a.id] = a.email;
        return acc;
      }, {});
    }
  }

  const enriched = (entries || []).map((e) => ({
    ...e,
    admin_email: adminEmails[e.admin_user_id] || "unknown",
  }));

  return NextResponse.json({
    entries: enriched,
    total: count ?? 0,
    page,
    limit,
  });
}
