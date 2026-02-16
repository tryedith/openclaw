import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

// GET /api/instances/[id]/channels - Get channel status from gateway
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "true";

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
    // Get channel status from gateway
    const result = await gatewayRpc<{
      channels: Record<string, { configured?: boolean; linked?: boolean; enabled?: boolean }>;
      channelLabels: Record<string, string>;
      channelMeta: Record<string, { label: string; blurb?: string; docsUrl?: string }>;
      channelAccounts?: Record<string, Array<{
        accountId: string;
        configured?: boolean;
        enabled?: boolean;
        probe?: {
          ok?: boolean;
          bot?: { username?: string };
        };
      }>>;
    }>({
      gatewayUrl,
      token,
      method: "channels.status",
      rpcParams: { probe },
    });

    if (!result.ok) {
      console.error("[channels] Gateway error:", result.error);
      // Check for service unavailable (503) or gateway timeout (504)
      const errorStr = String(result.error || "");
      if (errorStr.includes("503") || errorStr.includes("502") || errorStr.includes("504")) {
        return NextResponse.json(
          { error: "Gateway is restarting", details: "Please wait a moment and try again.", retryable: true },
          { status: 503 }
        );
      }
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
