import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/admin/audit";
import { NextResponse } from "next/server";
import { gatewayRpc, buildSessionKey } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

type SessionsResetResult = {
  ok?: boolean;
  key?: string;
};

// POST /api/admin/instances/[id]/chat/reset - Admin: reset chat session for any instance
export async function POST(
  _request: Request,
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

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  const sessionKey = buildSessionKey(instance.user_id);

  try {
    const result = await gatewayRpc<SessionsResetResult>({
      gatewayUrl,
      token,
      method: "sessions.reset",
      rpcParams: {
        key: sessionKey,
        reason: "new",
      },
      timeoutMs: 30000,
    });

    if (!result.ok) {
      console.error("[admin/chat.reset] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to reset chat", details: result.error },
        { status: 500 }
      );
    }

    void logAdminAction(auth.user.id, "chat.reset", "instance", id);

    return NextResponse.json({
      ok: true,
      key: result.payload?.key ?? sessionKey,
    });
  } catch (error) {
    console.error("[admin/chat.reset] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
