import { createClient } from "@/lib/supabase/server";
import { getECSClient } from "@/lib/aws/ecs-client";
import { NextResponse } from "next/server";

// DELETE /api/instances/[id] - Delete an instance
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log("[instances] DELETE - Instance ID:", id);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get instance from database
  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    console.log("[instances] DELETE - Instance not found");
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Delete AWS ECS resources
  if (instance.aws_service_arn) {
    try {
      console.log("[instances] DELETE - Deleting ECS service:", instance.aws_service_arn);
      const ecsClient = getECSClient();
      await ecsClient.deleteInstance({
        instanceId: id,
        serviceArn: instance.aws_service_arn,
        targetGroupArn: instance.aws_target_group_arn,
        ruleArn: instance.aws_rule_arn,
      });
      console.log("[instances] DELETE - ECS service deleted");
    } catch (error) {
      console.error("[instances] DELETE - Error deleting ECS service:", error);
      // Continue anyway - we still want to delete the DB record
    }
  }

  // Delete from database
  console.log("[instances] DELETE - Deleting from Supabase...");
  const { error: deleteError } = await supabase
    .from("instances")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("[instances] DELETE - Supabase delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete instance" },
      { status: 500 }
    );
  }

  console.log("[instances] DELETE - Instance deleted successfully");
  return NextResponse.json({ success: true });
}
