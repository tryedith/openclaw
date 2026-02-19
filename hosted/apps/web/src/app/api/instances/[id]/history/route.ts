import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getChatHistory, buildSessionKey } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

const MAX_HISTORY_LIMIT = 1000;
const DEFAULT_HISTORY_LIMIT = MAX_HISTORY_LIMIT;

// GET /api/instances/[id]/history - Get chat history from gateway
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
    console.error("[history] Failed to resolve gateway target:", error);
    return NextResponse.json(
      { error: "Failed to resolve gateway credentials", details: String(error) },
      { status: 500 }
    );
  }

  // Build session key matching what the chat endpoint uses
  const sessionKey = buildSessionKey(user.id);

  // Get optional limit from query params (default to max so chat opens with full thread)
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : DEFAULT_HISTORY_LIMIT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(MAX_HISTORY_LIMIT, parsedLimit)
      : DEFAULT_HISTORY_LIMIT;

  try {
    const result = await getChatHistory({
      gatewayUrl,
      token,
      sessionKey,
      limit,
    });

    if (!result.ok) {
      console.error("[history] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to fetch history", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ messages: result.messages });
  } catch (error) {
    console.error("[history] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
