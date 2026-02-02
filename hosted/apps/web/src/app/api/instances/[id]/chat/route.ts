import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc, buildSessionKey, getChatHistory } from "@/lib/gateway/ws-client";
import { randomUUID } from "crypto";

interface ChatSendResult {
  runId?: string;
  status?: string;
}

interface HistoryMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

// Helper to extract text from content blocks
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } =>
        block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

// Helper to wait
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /api/instances/[id]/chat - Proxy chat messages to the user's gateway
export async function POST(
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

  // Get message from request body
  const body = await request.json();
  const { message } = body;

  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Build gateway URL
  const gatewayUrl = instance.public_url.startsWith("http")
    ? instance.public_url
    : `https://${instance.public_url}`;

  // Build session key for this user
  const sessionKey = buildSessionKey(user.id);

  try {
    // Get current message count before sending
    const beforeHistory = await getChatHistory({
      gatewayUrl,
      token: instance.gateway_token_encrypted,
      sessionKey,
      limit: 100,
    });
    const messageCountBefore = beforeHistory.messages?.length || 0;
    console.log("[chat] Messages before send:", messageCountBefore);

    // Use WebSocket RPC to send chat message
    const result = await gatewayRpc<ChatSendResult>({
      gatewayUrl,
      token: instance.gateway_token_encrypted,
      method: "chat.send",
      rpcParams: {
        sessionKey,
        message,
        idempotencyKey: randomUUID(),
      },
      timeoutMs: 60000, // Chat can take a while
    });

    if (!result.ok) {
      console.error("[chat] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Gateway error", details: result.error },
        { status: 500 }
      );
    }

    console.log("[chat] Send result:", result.payload?.status, result.payload?.runId);

    // chat.send is async - poll history to get the response
    // Wait for the assistant response by polling chat.history
    const maxAttempts = 30; // 30 * 2s = 60s max wait
    let responseText = "";

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(2000); // Wait 2 seconds between polls

      const historyResult = await getChatHistory({
        gatewayUrl,
        token: instance.gateway_token_encrypted,
        sessionKey,
        limit: 100,
      });

      if (historyResult.ok && historyResult.messages) {
        const messages = historyResult.messages as HistoryMessage[];

        // Check if we have new messages (user message + assistant response)
        // We expect at least 2 new messages: our user message and the assistant reply
        if (messages.length >= messageCountBefore + 2) {
          // Get the last assistant message
          const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
          if (lastAssistant) {
            const text = extractText(lastAssistant.content);
            if (text) {
              responseText = text;
              console.log("[chat] Got response after", attempt + 1, "attempts");
              break;
            }
          }
        }
      }
    }

    if (!responseText) {
      responseText = "Response is taking longer than expected. Please refresh to see the reply.";
    }

    return NextResponse.json({ response: responseText });
  } catch (error) {
    console.error("[chat] Error:", error);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(error) },
      { status: 500 }
    );
  }
}
