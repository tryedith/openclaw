/**
 * SSM-based container restart for applying user API key changes.
 * Sends a RunCommand to the EC2 instance that:
 * 1. Reads platform credentials from Secrets Manager
 * 2. Reads per-instance user keys (if any)
 * 3. Merges them (user keys override platform keys)
 * 4. Restarts the Docker container with the merged env vars
 */

import {
  SSMClient,
  SendCommandCommand,
} from "@aws-sdk/client-ssm";

const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const ECR_REPOSITORY_URL = process.env.ECR_REPOSITORY_URL!;

const ssm = new SSMClient({ region: AWS_REGION });

function buildRestartScript(): string {
  const ecrRegistry = ECR_REPOSITORY_URL.split("/")[0];
  const ecrImage = ECR_REPOSITORY_URL + ":latest";

  // Plain shell script — no JS template interpolation inside shell vars
  return [
    "#!/bin/bash",
    "set -e",
    "",
    '# IMDSv2 metadata',
    'IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")',
    'INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
    'REGION=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/placement/region)',
    "",
    "# Preserve the gateway token from the running container",
    'GATEWAY_TOKEN=$(docker exec openclaw-gateway printenv OPENCLAW_GATEWAY_TOKEN 2>/dev/null || echo "")',
    'if [ -z "$GATEWAY_TOKEN" ]; then',
    '  echo "ERROR: Could not read OPENCLAW_GATEWAY_TOKEN from running container"',
    "  exit 1",
    "fi",
    "",
    "# Read platform credentials",
    "PLATFORM_SECRETS=$(aws secretsmanager get-secret-value --region $REGION \\",
    "  --secret-id openclaw/platform-credentials \\",
    "  --query SecretString --output text)",
    "",
    "# Read per-instance user keys (may not exist yet)",
    'USER_KEYS=$(aws secretsmanager get-secret-value --region $REGION \\',
    '  --secret-id "openclaw/instance/$INSTANCE_ID/user-keys" \\',
    "  --query SecretString --output text 2>/dev/null || echo '{}')",
    "",
    "# Merge: user keys override platform keys",
    'MERGED=$(echo "$PLATFORM_SECRETS" "$USER_KEYS" | jq -s \'.[0] * .[1]\')',
    "",
    "ANTHROPIC_API_KEY=$(echo \"$MERGED\" | jq -r '.ANTHROPIC_API_KEY // empty')",
    "OPENAI_API_KEY=$(echo \"$MERGED\" | jq -r '.OPENAI_API_KEY // empty')",
    "GEMINI_API_KEY=$(echo \"$MERGED\" | jq -r '.GEMINI_API_KEY // empty')",
    "HOSTED_USAGE_REPORT_URL=$(echo \"$MERGED\" | jq -r '.HOSTED_USAGE_REPORT_URL // empty')",
    "USAGE_SERVICE_KEY=$(echo \"$MERGED\" | jq -r '.USAGE_SERVICE_KEY // empty')",
    "",
    "# State/workspace dirs (created by user_data at boot)",
    "STATE_DIR=/var/lib/openclaw/state",
    "WORKSPACE_DIR=/var/lib/openclaw/workspace",
    "mkdir -p $STATE_DIR $WORKSPACE_DIR",
    "chown -R 1000:1000 /var/lib/openclaw",
    "",
    "# Stop and remove the existing container",
    "docker stop openclaw-gateway 2>/dev/null || true",
    "docker rm openclaw-gateway 2>/dev/null || true",
    "",
    "# Pull latest image",
    `aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${ecrRegistry} 2>/dev/null`,
    `docker pull ${ecrImage}`,
    "",
    "# Start with merged env vars",
    "docker run -d --name openclaw-gateway --restart=always -p 8080:8080 \\",
    "  -v $STATE_DIR:/tmp/.openclaw \\",
    "  -v $WORKSPACE_DIR:/home/node/.openclaw/workspace \\",
    '  -e OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \\',
    '  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \\',
    '  -e OPENAI_API_KEY="$OPENAI_API_KEY" \\',
    '  -e GEMINI_API_KEY="$GEMINI_API_KEY" \\',
    '  -e HOSTED_USAGE_REPORT_URL="$HOSTED_USAGE_REPORT_URL" \\',
    '  -e USAGE_SERVICE_KEY="$USAGE_SERVICE_KEY" \\',
    "  -e OPENCLAW_CONFIG_PATH=/app/hosted-config.json \\",
    "  -e OPENCLAW_STATE_DIR=/tmp/.openclaw \\",
    "  -e PORT=8080 \\",
    "  -e NODE_ENV=production \\",
    `  ${ecrImage}`,
    "",
    "# Wait for healthy",
    "for i in $(seq 1 30); do",
    "  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then",
    '    echo "Container restarted and healthy"',
    "    exit 0",
    "  fi",
    "  sleep 1",
    "done",
    "",
    'echo "WARNING: Container did not become healthy within 30s"',
    "docker logs openclaw-gateway --tail 10",
    "exit 1",
  ].join("\n");
}

/**
 * Restart the gateway container on an EC2 instance with merged API keys.
 * User-provided keys override platform keys for the same provider.
 */
export async function restartContainerWithKeys(params: {
  ec2InstanceId: string;
}): Promise<{ commandId: string }> {
  const { ec2InstanceId } = params;

  const result = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [ec2InstanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [buildRestartScript()],
      },
      TimeoutSeconds: 120,
    })
  );

  const commandId = result.Command?.CommandId;
  if (!commandId) {
    throw new Error("SSM SendCommand returned no CommandId");
  }

  return { commandId };
}
