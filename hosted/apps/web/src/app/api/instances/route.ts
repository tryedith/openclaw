import { createClient } from "@/lib/supabase/server";
import { getECSClient } from "@/lib/aws/ecs-client";
import { NextResponse } from "next/server";
import crypto from "crypto";

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
    const ecsClient = getECSClient();

    for (const instance of instances) {
      if (instance.status === "provisioning" && instance.aws_service_arn) {
        try {
          // Check ECS service status
          const ecsStatus = await ecsClient.getServiceStatus(instance.aws_service_arn);

          if (ecsStatus.runningCount > 0 && ecsStatus.healthy) {
            // Update to running
            await supabase
              .from("instances")
              .update({
                status: "running",
                last_health_at: new Date().toISOString(),
              })
              .eq("id", instance.id);
            instance.status = "running";
          } else if (ecsStatus.failedCount > 0) {
            // Update to error
            await supabase
              .from("instances")
              .update({
                status: "error",
                error_message: "ECS task failed to start",
              })
              .eq("id", instance.id);
            instance.status = "error";
          }
        } catch (err) {
          console.error("[instances] Error checking ECS status:", err);
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

  // Generate a secure gateway token
  const gatewayToken = crypto.randomBytes(32).toString("hex");
  console.log("[instances] POST - Generated gateway token");

  // Create instance record first (status: provisioning)
  console.log("[instances] POST - Creating Supabase record...");
  const { data: instance, error: insertError } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: "default",
      status: "provisioning",
      provider: "aws",
      gateway_token_encrypted: gatewayToken, // TODO: encrypt in production
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

  // Provision container on AWS ECS
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }
    console.log("[instances] POST - Anthropic key found");

    console.log("[instances] POST - Provisioning on AWS ECS...");
    const ecsClient = getECSClient();

    const { serviceArn, targetGroupArn, ruleArn, url } = await ecsClient.createInstance({
      userId: user.id,
      instanceId: instance.id,
      gatewayToken,
      anthropicApiKey,
    });
    console.log("[instances] POST - ECS Service created:", { serviceArn, url });

    // Update instance with AWS details
    console.log("[instances] POST - Updating Supabase with AWS details...");
    await supabase
      .from("instances")
      .update({
        provider_resource_id: serviceArn,
        aws_service_arn: serviceArn,
        aws_target_group_arn: targetGroupArn,
        aws_rule_arn: ruleArn,
        public_url: url,
        status: "provisioning",
      })
      .eq("id", instance.id);

    console.log("[instances] POST - Success! Instance provisioning started.");
    return NextResponse.json({
      id: instance.id,
      status: "provisioning",
      message: "Instance is being created. This may take 2-3 minutes.",
    });
  } catch (error) {
    console.error("[instances] POST - Provisioning error:", error);

    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("instances")
      .update({
        status: "error",
        error_message: errorMsg,
      })
      .eq("id", instance.id);

    return NextResponse.json(
      { error: "Failed to provision container: " + errorMsg },
      { status: 500 }
    );
  }
}
