import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

interface PairingListResult {
  channel: string;
  requests: PairingRequest[];
}

// GET /api/instances/[id]/channels/[channel]/pairing - List pending pairing requests
export async function GET(
  request: Request,
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

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  try {
    const result = await gatewayRpc<PairingListResult>({
      gatewayUrl,
      token,
      method: "channel.pairing.list",
      rpcParams: { channel },
    });

    if (!result.ok) {
      console.error("[pairing/list] Failed:", { channel, error: result.error, gatewayUrl });
      return NextResponse.json(
        { error: "Failed to list pairing requests", details: result.error, channel },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      channel: result.payload?.channel,
      requests: result.payload?.requests || [],
    });
  } catch (error) {
    console.error("[pairing/list] Error:", error);
    return NextResponse.json(
      { error: "Failed to list pairing requests", details: String(error) },
      { status: 500 }
    );
  }
}
