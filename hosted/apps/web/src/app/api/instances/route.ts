import { createClient } from "@/lib/supabase/server";
import { getInstanceClient } from "@/lib/aws/instance-client";
import { encryptGatewayToken } from "@/lib/crypto";
import { NextResponse } from "next/server";

// GET /api/instances - List user's instances
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instances, error } = await supabase
    .from("instances")
    .select(
      `
      id,
      name,
      status,
      public_url,
      created_at,
      updated_at,
      last_health_at,
      aws_service_arn,
      channels (
        id,
        channel_type,
        status,
        linked_identity
      )
    `
    )
    .eq("user_id", user.id);

  if (error) {
    console.error("Error fetching instances:", error);
    return NextResponse.json(
      { error: "Failed to fetch instances" },
      { status: 500 }
    );
  }

  // Sync status for provisioning instances
  if (instances && instances.length > 0) {
    const instanceClient = getInstanceClient();

    for (const instance of instances) {
      if (instance.status === "provisioning" && instance.aws_service_arn) {
        try {
          // Check EC2 instance status (aws_service_arn now stores EC2 instance ID)
          const ec2Status = await instanceClient.getInstanceStatus(user.id);

          if (ec2Status.status === "running") {
            // Update to running
            await supabase
              .from("instances")
              .update({
                status: "running",
                last_health_at: new Date().toISOString(),
              })
              .eq("id", instance.id);
            instance.status = "running";
          } else if (ec2Status.status === "error") {
            // Update to error
            await supabase
              .from("instances")
              .update({
                status: "error",
                error_message: "EC2 instance failed to start",
              })
              .eq("id", instance.id);
            instance.status = "error";
          }
        } catch (err) {
          console.error("[instances] Error checking EC2 status:", err);
        }
      }
    }
  }

  return NextResponse.json({ instances: instances || [] });
}

// POST /api/instances - Create a new instance
export async function POST() {
  console.log("[instances] POST - Starting instance creation...");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.log("[instances] POST - Unauthorized: No user");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log("[instances] POST - User:", user.email);

  // Check if user already has an instance (MVP: one per user)
  const { count } = await supabase
    .from("instances")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  console.log("[instances] POST - Existing instances:", count);
  if (count && count >= 1) {
    return NextResponse.json(
      { error: "Instance limit reached. Free tier allows 1 instance." },
      { status: 400 }
    );
  }

  // Create instance record first (status: provisioning)
  // gateway_token_encrypted will be updated after we get it from the EC2 instance
  console.log("[instances] POST - Creating Supabase record...");
  const { data: instance, error: insertError } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: "default",
      status: "provisioning",
      provider: "aws",
      gateway_token_encrypted: "pending", // Placeholder, will be updated
    })
    .select()
    .single();

  if (insertError) {
    console.error("[instances] POST - Supabase insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create instance: " + insertError.message },
      { status: 500 }
    );
  }
  console.log("[instances] POST - Supabase record created:", instance.id);

  // Provision EC2 instance from pool (container already running, get gateway token)
  try {
    console.log("[instances] POST - Assigning EC2 instance from pool...");
    const instanceClient = getInstanceClient();

    const { ec2InstanceId, targetGroupArn, ruleArn, url, gatewayToken } = await instanceClient.createInstance({
      userId: user.id,
      instanceId: instance.id,
    });
    console.log("[instances] POST - EC2 instance assigned:", { ec2InstanceId, url });

    // Update instance with AWS details and gateway token
    console.log("[instances] POST - Updating Supabase with AWS details...");
    await supabase
      .from("instances")
      .update({
        provider_resource_id: ec2InstanceId,
        aws_service_arn: ec2InstanceId, // Stores EC2 instance ID
        aws_target_group_arn: targetGroupArn,
        aws_rule_arn: ruleArn,
        public_url: url,
        gateway_token_encrypted: encryptGatewayToken(gatewayToken),
        status: "running", // Container is already running
      })
      .eq("id", instance.id);

    console.log("[instances] POST - Success! Instance is ready.");
    return NextResponse.json({
      id: instance.id,
      status: "running",
      url,
      message: "Instance is ready.",
    });
  } catch (error) {
    console.error("[instances] POST - Provisioning error:", error);

    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const errorMsg =
      rawMsg === "Could not load credentials from any providers"
        ? "Could not load AWS credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_REGION) in the Vercel environment for the hosted web app."
        : rawMsg;
    await supabase
      .from("instances")
      .update({
        status: "error",
        error_message: errorMsg,
      })
      .eq("id", instance.id);

    return NextResponse.json(
      { error: "Failed to provision instance: " + errorMsg },
      { status: 500 }
    );
  }
}
