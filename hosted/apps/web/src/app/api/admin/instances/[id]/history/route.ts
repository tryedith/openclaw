import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { getChatHistory, buildSessionKey } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

const MAX_HISTORY_LIMIT = 1000;
const DEFAULT_HISTORY_LIMIT = MAX_HISTORY_LIMIT;

// GET /api/admin/instances/[id]/history - Admin: get chat history for any instance
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  const { id } = await params;
  const admin = createAdminClient();

  const { data: instance, error } = await admin
    .from("instances")
    .select("*")
    .eq("id", id)
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
    console.error("[admin/history] Failed to resolve gateway target:", error);
    return NextResponse.json(
      { error: "Failed to resolve gateway credentials", details: String(error) },
      { status: 500 }
    );
  }

  // Use the instance owner's session key to see their conversation
  const sessionKey = buildSessionKey(instance.user_id);

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
      console.error("[admin/history] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to fetch history", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ messages: result.messages });
  } catch (error) {
    console.error("[admin/history] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
