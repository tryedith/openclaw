import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc, buildSessionKey } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";

type SessionsResetResult = {
  ok?: boolean;
  key?: string;
};

// POST /api/instances/[id]/chat/reset - Start a fresh session transcript for this user
export async function POST(
  _request: Request,
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

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: instance.gateway_token_encrypted,
    instanceId: id,
  });

  const sessionKey = buildSessionKey(user.id);

  try {
    const result = await gatewayRpc<SessionsResetResult>({
      gatewayUrl,
      token,
      method: "sessions.reset",
      rpcParams: {
        key: sessionKey,
      },
      timeoutMs: 30000,
    });

    if (!result.ok) {
      console.error("[chat.reset] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to reset chat", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      key: result.payload?.key ?? sessionKey,
    });
  } catch (error) {
    console.error("[chat.reset] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
