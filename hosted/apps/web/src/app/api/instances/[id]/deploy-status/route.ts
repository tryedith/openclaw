import { createClient } from "@/lib/supabase/server";
import { getInstanceClient } from "@/lib/aws/instance-client";
import { NextResponse } from "next/server";

// GET /api/instances/[id]/deploy-status - Get live deployment status from EC2
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
      logs: ["Waiting for EC2 instance assignment..."],
    });
  }

  try {
    const instanceClient = getInstanceClient();
    const status = await instanceClient.getInstanceStatus(user.id);

    const logs: string[] = [];
    const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

    logs.push(`$ EC2 Instance Status`);
    logs.push(`Instance: ${instance.aws_service_arn}`);
    logs.push("");

    // Map EC2 status to phase
    let phase = "PENDING";

    switch (status.status) {
      case "running":
        phase = "ACTIVE";
        logs.push(`[${timestamp()}] ✓ Instance is running`);
        if (status.privateIp) {
          logs.push(`[${timestamp()}] ✓ Private IP: ${status.privateIp}`);
        }
        logs.push("");
        logs.push("✓ Deployment successful!");
        break;

      case "provisioning":
        phase = "DEPLOYING";
        logs.push(`[${timestamp()}] → Starting container on instance...`);
        logs.push(`[${timestamp()}] → EC2 Instance: ${status.ec2InstanceId || "assigning"}`);
        logs.push("");
        logs.push("Status: Deploying...");
        break;

      case "pending":
        phase = "DEPLOYING";
        logs.push(`[${timestamp()}] → Assigning instance from pool...`);
        logs.push("");
        logs.push("Status: Pending...");
        break;

      case "stopped":
        phase = "INACTIVE";
        logs.push(`[${timestamp()}] Instance is stopped`);
        break;

      case "error":
        phase = "ERROR";
        logs.push(`[${timestamp()}] ✗ Instance encountered an error`);
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
          error_message: "EC2 instance failed to start",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }

    return NextResponse.json({ phase, logs });
  } catch (error) {
    console.error("[deploy-status] EC2 Error:", error);
    return NextResponse.json({
      phase: "UNKNOWN",
      logs: [`Error: ${error instanceof Error ? error.message : "Failed to fetch EC2 status"}`],
    });
  }
}
