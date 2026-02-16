import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

interface PairingApproveResult {
  ok: boolean;
  channel: string;
  id: string;
  entry?: {
    id: string;
    code: string;
    createdAt: string;
    lastSeenAt: string;
    meta?: Record<string, string>;
  };
}

// POST /api/instances/[id]/channels/[channel]/pairing/approve - Approve a pairing code
export async function POST(
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

  const body = await request.json();
  const { code, notify } = body as { code: string; notify?: boolean };

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  try {
    const result = await gatewayRpc<PairingApproveResult>({
      gatewayUrl,
      token,
      method: "channel.pairing.approve",
      rpcParams: { channel, code, notify: notify ?? true },
    });

    if (!result.ok) {
      console.error("[pairing/approve] Failed:", result.error);
      return NextResponse.json(
        { error: "Failed to approve pairing request", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      channel: result.payload?.channel,
      id: result.payload?.id,
      entry: result.payload?.entry,
    });
  } catch (error) {
    console.error("[pairing/approve] Error:", error);
    return NextResponse.json(
      { error: "Failed to approve pairing request", details: String(error) },
      { status: 500 }
    );
  }
}
