import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { restartContainerWithKeys } from "@/lib/aws/ssm-restart";
import { NextResponse } from "next/server";

// POST /api/admin/instances/[id]/restart - Restart instance container via SSM
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
    .select("id, name, aws_service_arn, user_id")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.aws_service_arn) {
    return NextResponse.json({ error: "Instance has no EC2 instance ID" }, { status: 400 });
  }

  try {
    const { commandId } = await restartContainerWithKeys({
      ec2InstanceId: instance.aws_service_arn,
    });

    await logAdminAction(auth.user.id, "instance.restart", "instance", id, {
      ec2InstanceId: instance.aws_service_arn,
      commandId,
    });

    return NextResponse.json({ ok: true, commandId });
  } catch (err) {
    console.error("[admin/instances] Restart error:", err);
    return NextResponse.json(
      { error: "Failed to restart instance: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
