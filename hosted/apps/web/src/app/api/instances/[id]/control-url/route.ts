import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

// GET /api/instances/[id]/control-url - Get tokenized Control UI URL
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
    .select("public_url, gateway_token_encrypted")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url) {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  let gatewayUrl: string;
  let token: string;
  try {
    const resolved = resolveGatewayTarget({
      instancePublicUrl: instance.public_url,
      instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
      instanceId: id,
    });
    gatewayUrl = resolved.gatewayUrl;
    token = resolved.token;
  } catch (error) {
    console.error("[control-url] Failed to resolve gateway target:", error);
    return NextResponse.json(
      { error: "Failed to resolve gateway credentials", details: String(error) },
      { status: 500 }
    );
  }
  const tokenizedUrl = `${gatewayUrl}/?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ url: tokenizedUrl });
}
