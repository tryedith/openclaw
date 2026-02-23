import { createAdminClient } from "@/lib/supabase/admin";

export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("admin_audit_log").insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details: details ?? {},
  });
}
