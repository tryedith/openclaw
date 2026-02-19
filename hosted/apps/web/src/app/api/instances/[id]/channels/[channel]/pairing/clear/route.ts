import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

// POST /api/instances/[id]/channels/[channel]/pairing/clear
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; channel: string }> }
) {
  const { id, channel } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  const result = await gatewayRpc<{ ok?: boolean; cleared?: boolean; previousCount?: number }>({
    gatewayUrl,
    token,
    method: "channel.pairing.clear",
    rpcParams: { channel },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Failed to clear pairing requests", details: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    cleared: result.payload?.cleared === true,
    previousCount:
      typeof result.payload?.previousCount === "number" ? result.payload.previousCount : undefined,
  });
}

