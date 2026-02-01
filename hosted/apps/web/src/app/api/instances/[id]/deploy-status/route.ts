import { createClient } from "@/lib/supabase/server";
import { getECSClient } from "@/lib/aws/ecs-client";
import { NextResponse } from "next/server";

// GET /api/instances/[id]/deploy-status - Get live deployment status from ECS
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.aws_service_arn) {
    return NextResponse.json({
      phase: "PENDING",
      logs: ["Waiting for ECS service creation..."],
    });
  }

  try {
    const ecsClient = getECSClient();
    const status = await ecsClient.getInstanceStatus(instance.aws_service_arn);

    const logs: string[] = [];
    const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

    logs.push(`$ ECS Service Status`);
    logs.push(`Service: ${instance.aws_service_arn.split("/").pop()}`);
    logs.push("");

    // Map ECS status to phase
    let phase = "PENDING";

    switch (status.status) {
      case "running":
        phase = "ACTIVE";
        logs.push(`[${timestamp()}] ✓ Service is running`);
        logs.push(`[${timestamp()}] ✓ Tasks: ${status.runningCount}/${status.desiredCount}`);
        logs.push("");
        logs.push("✓ Deployment successful!");
        break;

      case "provisioning":
        phase = "DEPLOYING";
        logs.push(`[${timestamp()}] → Provisioning tasks...`);
        logs.push(`[${timestamp()}] → Running: ${status.runningCount}, Pending: ${status.pendingCount}`);
        logs.push(`[${timestamp()}] → Desired: ${status.desiredCount}`);
        logs.push("");
        logs.push("Status: Deploying...");
        break;

      case "stopped":
        phase = "INACTIVE";
        logs.push(`[${timestamp()}] Service is stopped`);
        break;

      case "error":
        phase = "ERROR";
        logs.push(`[${timestamp()}] ✗ Service encountered an error`);
        logs.push("");
        logs.push("✗ Deployment failed");
        break;

      default:
        logs.push(`[${timestamp()}] → Status: ${status.status}`);
        logs.push("Status: Pending...");
    }

    // Update instance status in database if changed
    if (status.status === "running" && instance.status !== "running") {
      await supabase
        .from("instances")
        .update({
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    } else if (status.status === "error" && instance.status !== "error") {
      await supabase
        .from("instances")
        .update({
          status: "error",
          error_message: "ECS service failed to start",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }

    return NextResponse.json({ phase, logs });
  } catch (error) {
    console.error("[deploy-status] ECS Error:", error);
    return NextResponse.json({
      phase: "UNKNOWN",
      logs: [`Error: ${error instanceof Error ? error.message : "Failed to fetch ECS status"}`],
    });
  }
}
