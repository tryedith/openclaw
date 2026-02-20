import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptGatewayToken } from "@/lib/crypto";
import { restartContainerWithKeys } from "@/lib/aws/ssm-restart";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { NextResponse } from "next/server";

const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const secrets = new SecretsManagerClient({ region: AWS_REGION });

const VALID_PROVIDERS = ["anthropic", "openai", "google"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

// Map provider to the env var key name used in Secrets Manager
const PROVIDER_KEY_MAP: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

async function verifyInstanceOwnership(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {return { error: "Unauthorized" as const, status: 401, user: null, instance: null };}

  const { data: instance } = await supabase
    .from("instances")
    .select("id, user_id, aws_service_arn, status")
    .eq("id", instanceId)
    .eq("user_id", user.id)
    .single();

  if (!instance) {return { error: "Instance not found" as const, status: 404, user: null, instance: null };}

  return { error: null, status: 200, user, instance };
}

/**
 * Read the current user-keys JSON from Secrets Manager for an EC2 instance.
 * Returns empty object if the secret doesn't exist.
 */
async function readUserKeysSecret(ec2InstanceId: string): Promise<Record<string, string>> {
  try {
    const result = await secrets.send(
      new GetSecretValueCommand({
        SecretId: `openclaw/instance/${ec2InstanceId}/user-keys`,
      })
    );
    return JSON.parse(result.SecretString || "{}");
  } catch {
    return {};
  }
}

/**
 * Write the user-keys JSON to Secrets Manager (create or update).
 */
async function writeUserKeysSecret(ec2InstanceId: string, keys: Record<string, string>): Promise<void> {
  const secretId = `openclaw/instance/${ec2InstanceId}/user-keys`;
  const secretString = JSON.stringify(keys);

  try {
    await secrets.send(
      new CreateSecretCommand({
        Name: secretId,
        SecretString: secretString,
        Tags: [
          { Key: "ManagedBy", Value: "openclaw" },
          { Key: "InstanceId", Value: ec2InstanceId },
        ],
      })
    );
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name;
    if (code === "ResourceExistsException") {
      await secrets.send(
        new PutSecretValueCommand({
          SecretId: secretId,
          SecretString: secretString,
        })
      );
    } else {
      throw err;
    }
  }
}

// GET /api/instances/[id]/api-keys — list which providers have user-provided keys
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error, status } = await verifyInstanceOwnership(id);
  if (error) {return NextResponse.json({ error }, { status });}

  const adminClient = createAdminClient();
  const { data: keys } = await adminClient
    .from("instance_api_keys")
    .select("provider, updated_at")
    .eq("instance_id", id);

  const keyStatus = VALID_PROVIDERS.map((provider) => {
    const existing = keys?.find((k) => k.provider === provider);
    return {
      provider,
      hasKey: !!existing,
      updatedAt: existing?.updated_at ?? null,
    };
  });

  return NextResponse.json({ keys: keyStatus });
}

// POST /api/instances/[id]/api-keys — set/update a user API key for a provider
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error, status, instance } = await verifyInstanceOwnership(id);
  if (error) {return NextResponse.json({ error }, { status });}

  const body = await request.json();
  const provider = body.provider as string;
  const apiKey = (body.apiKey as string)?.trim();

  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!apiKey || apiKey.length < 10) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  const ec2InstanceId = instance.aws_service_arn;
  if (!ec2InstanceId) {
    return NextResponse.json(
      { error: "Instance has no associated EC2 instance" },
      { status: 400 }
    );
  }

  // Encrypt and store in Supabase
  const encryptedKey = encryptGatewayToken(apiKey);
  const adminClient = createAdminClient();
  const { error: upsertError } = await adminClient
    .from("instance_api_keys")
    .upsert(
      { instance_id: id, provider, encrypted_key: encryptedKey },
      { onConflict: "instance_id,provider" }
    );

  if (upsertError) {
    console.error("[api-keys] Upsert error:", upsertError);
    return NextResponse.json({ error: "Failed to save API key" }, { status: 500 });
  }

  // Update Secrets Manager with the new key
  const currentKeys = await readUserKeysSecret(ec2InstanceId);
  const envVarName = PROVIDER_KEY_MAP[provider as Provider];
  currentKeys[envVarName] = apiKey;
  await writeUserKeysSecret(ec2InstanceId, currentKeys);

  // Restart the container to pick up the new key
  try {
    const { commandId } = await restartContainerWithKeys({ ec2InstanceId });
    console.log(`[api-keys] Container restart triggered for ${ec2InstanceId}, command: ${commandId}`);

    return NextResponse.json({
      ok: true,
      provider,
      restart: { commandId, scheduled: true },
    });
  } catch (err) {
    console.error("[api-keys] SSM restart failed:", err);
    return NextResponse.json(
      { error: "API key saved but container restart failed. The key will apply on next restart." },
      { status: 207 }
    );
  }
}

// DELETE /api/instances/[id]/api-keys — remove a user API key for a provider
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error, status, instance } = await verifyInstanceOwnership(id);
  if (error) {return NextResponse.json({ error }, { status });}

  const body = await request.json();
  const provider = body.provider as string;

  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  const ec2InstanceId = instance.aws_service_arn;

  // Remove from Supabase
  const adminClient = createAdminClient();
  await adminClient
    .from("instance_api_keys")
    .delete()
    .eq("instance_id", id)
    .eq("provider", provider);

  // Update Secrets Manager (remove the key)
  if (ec2InstanceId) {
    const currentKeys = await readUserKeysSecret(ec2InstanceId);
    const envVarName = PROVIDER_KEY_MAP[provider as Provider];
    delete currentKeys[envVarName];
    await writeUserKeysSecret(ec2InstanceId, currentKeys);

    // Restart to fall back to platform key
    try {
      const { commandId } = await restartContainerWithKeys({ ec2InstanceId });
      console.log(`[api-keys] Container restart (key removal) for ${ec2InstanceId}, command: ${commandId}`);
    } catch (err) {
      console.error("[api-keys] SSM restart after key removal failed:", err);
    }
  }

  return NextResponse.json({ ok: true, provider, removed: true });
}
