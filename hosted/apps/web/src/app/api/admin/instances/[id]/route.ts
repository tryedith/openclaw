import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstanceClient } from "@/lib/aws/instance-client";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";
import { NextResponse } from "next/server";

// GET /api/admin/instances/[id] - Instance detail with user, channels, EC2 status
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const admin = createAdminClient();

  const { data: instance, error } = await admin
    .from("instances")
    .select("*, users(email, display_name)")
    .eq("id", id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Get live channels from the gateway (not from DB — channels table is unused)
  let channels: { name: string; configured: boolean; linked: boolean; enabled: boolean }[] = [];
  if (instance.public_url && instance.status === "running" && instance.gateway_token_encrypted) {
    try {
      const { gatewayUrl, token } = resolveGatewayTarget({
        instancePublicUrl: instance.public_url,
        instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
        instanceId: id,
      });

      const result = await gatewayRpc<{
        channels: Record<string, { configured?: boolean; linked?: boolean; enabled?: boolean }>;
      }>({
        gatewayUrl,
        token,
        method: "channels.status",
        rpcParams: { probe: false },
        timeoutMs: 10000,
      });

      if (result.ok && result.payload?.channels) {
        channels = Object.entries(result.payload.channels)
          .filter(([, v]) => v.configured)
          .map(([name, v]) => ({
            name,
            configured: !!v.configured,
            linked: !!v.linked,
            enabled: !!v.enabled,
          }));
      }
    } catch (err) {
      console.error("[admin/instances] Gateway channel fetch error:", err);
    }
  }

  // Get live EC2 status
  let ec2Status = null;
  if (instance.aws_service_arn) {
    try {
      const instanceClient = getInstanceClient();
      ec2Status = await instanceClient.getInstanceStatus(instance.aws_service_arn);
    } catch (err) {
      console.error("[admin/instances] EC2 status error:", err);
    }
  }

  // Get usage for this instance (current month)
  const { data: usageData } = await admin
    .from("usage_events")
    .select("model_id, input_tokens, output_tokens, cost_usd")
    .eq("instance_id", id)
    .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  const usage = { totalCostUsd: 0, totalRequests: 0 };
  if (usageData) {
    for (const row of usageData) {
      usage.totalCostUsd += Number(row.cost_usd) || 0;
      usage.totalRequests += 1;
    }
    usage.totalCostUsd = Math.round(usage.totalCostUsd * 1_000_000) / 1_000_000;
  }

  return NextResponse.json({
    instance: {
      ...instance,
      user_email: (instance.users as unknown as { email: string })?.email,
      user_display_name: (instance.users as unknown as { display_name: string })?.display_name,
      users: undefined,
      gateway_token_encrypted: undefined,
    },
    channels,
    ec2Status,
    usage,
  });
}
