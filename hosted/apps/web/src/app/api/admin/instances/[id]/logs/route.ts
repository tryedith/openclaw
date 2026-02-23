import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import { NextResponse } from "next/server";

const AWS_REGION = process.env.AWS_REGION || "us-west-2";

// GET /api/admin/instances/[id]/logs - Fetch container logs via SSM
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const url = new URL(request.url);
  const tail = Math.min(500, Math.max(10, parseInt(url.searchParams.get("tail") || "200", 10)));

  const admin = createAdminClient();

  const { data: instance, error } = await admin
    .from("instances")
    .select("id, aws_service_arn")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.aws_service_arn) {
    return NextResponse.json({ error: "Instance has no EC2 instance ID" }, { status: 400 });
  }

  try {
    const ssm = new SSMClient({ region: AWS_REGION });

    // Send command to get docker logs
    const sendResult = await ssm.send(
      new SendCommandCommand({
        InstanceIds: [instance.aws_service_arn],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [`docker logs openclaw-gateway --tail ${tail} 2>&1`],
        },
        TimeoutSeconds: 30,
      })
    );

    const commandId = sendResult.Command?.CommandId;
    if (!commandId) {
      return NextResponse.json({ error: "Failed to send SSM command" }, { status: 500 });
    }

    // Poll for result (up to 15 seconds)
    let output = "";
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const invocation = await ssm.send(
          new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: instance.aws_service_arn,
          })
        );

        if (invocation.Status === "Success") {
          output = invocation.StandardOutputContent || "";
          break;
        }
        if (invocation.Status === "Failed" || invocation.Status === "Cancelled") {
          output = invocation.StandardErrorContent || invocation.StandardOutputContent || "Command failed";
          break;
        }
      } catch {
        // InvocationDoesNotExist — command hasn't reached the instance yet
      }
    }

    return NextResponse.json({ logs: output, commandId });
  } catch (err) {
    console.error("[admin/instances] Logs error:", err);
    return NextResponse.json(
      { error: "Failed to fetch logs: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
