import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getChatHistory, buildSessionKey } from "@/lib/gateway/ws-client";

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

  // Build gateway URL
  const gatewayUrl = instance.public_url.startsWith("http")
    ? instance.public_url
    : `https://${instance.public_url}`;

  // Build session key matching what the chat endpoint uses
  const sessionKey = buildSessionKey(user.id);

  // Get optional limit from query params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 100;

  try {
    const result = await getChatHistory({
      gatewayUrl,
      token: instance.gateway_token_encrypted,
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
