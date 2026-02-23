import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstanceClient } from "@/lib/aws/instance-client";
import { NextResponse } from "next/server";

// POST /api/admin/instances/[id]/stop - Stop/terminate instance
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const admin = createAdminClient();

  const { data: instance, error } = await admin
    .from("instances")
    .select("id, name, aws_service_arn, aws_target_group_arn, aws_rule_arn, user_id")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.aws_service_arn) {
    return NextResponse.json({ error: "Instance has no EC2 instance ID" }, { status: 400 });
  }

  try {
    const instanceClient = getInstanceClient();
    await instanceClient.deleteInstance({
      instanceId: id,
      ec2InstanceId: instance.aws_service_arn,
      targetGroupArn: instance.aws_target_group_arn ?? undefined,
      ruleArn: instance.aws_rule_arn ?? undefined,
    });

    // Update instance status in DB
    await admin
      .from("instances")
      .update({ status: "stopped" })
      .eq("id", id);

    await logAdminAction(auth.user.id, "instance.stop", "instance", id, {
      ec2InstanceId: instance.aws_service_arn,
      userId: instance.user_id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/instances] Stop error:", err);
    return NextResponse.json(
      { error: "Failed to stop instance: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
