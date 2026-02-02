import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";

// GET /api/instances/[id]/channels - Get channel status from gateway
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

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const gatewayUrl = instance.public_url.startsWith("http")
    ? instance.public_url
    : `https://${instance.public_url}`;

  try {
    // Get channel status from gateway
    const result = await gatewayRpc<{
      channels: Record<string, { configured?: boolean; linked?: boolean; enabled?: boolean }>;
      channelLabels: Record<string, string>;
      channelMeta: Record<string, { label: string; blurb?: string; docsUrl?: string }>;
    }>({
      gatewayUrl,
      token: instance.gateway_token_encrypted,
      method: "channels.status",
      rpcParams: { probe: false },
    });

    if (!result.ok) {
      console.error("[channels] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to fetch channels", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result.payload);
  } catch (error) {
    console.error("[channels] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
