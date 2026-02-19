/**
 * Gateway WebSocket Client
 * Used to call gateway RPC methods like chat.history
 */

import { WebSocket } from "ws";
import { randomUUID } from "crypto";

const PROTOCOL_VERSION = 3;

interface GatewayMessage {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
}

interface ChatHistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  timestamp?: number;
}

interface ChatHistoryResult {
  sessionKey: string;
  sessionId?: string;
  messages: ChatHistoryMessage[];
  thinkingLevel?: string;
}

function rawDataToText(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Buffer) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

/**
 * Create a short-lived WebSocket connection to the gateway,
 * execute an RPC call, and close the connection.
 */
export async function gatewayRpc<T = unknown>(params: {
  gatewayUrl: string;
  token: string;
  method: string;
  rpcParams: unknown;
  timeoutMs?: number;
}): Promise<{ ok: boolean; payload?: T; error?: string }> {
  const { gatewayUrl, token, method, rpcParams, timeoutMs = 30000 } = params;

  // Normalize URL to WebSocket
  const wsUrl = gatewayUrl
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/$/, "");

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ ok: false, error: "Connection timeout" });
    }, timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timeout);
      resolve({ ok: false, error: `Failed to connect: ${String(err)}` });
      return;
    }

    let connected = false;
    const pendingRequests = new Map<string, (res: GatewayMessage) => void>();

    ws.on("error", (err) => {
      clearTimeout(timeout);
      ws.close();
      resolve({ ok: false, error: `WebSocket error: ${err.message}` });
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (!connected) {
        resolve({ ok: false, error: "Connection closed before completing" });
      }
    });

    ws.on("message", (data) => {
      try {
        const msg: GatewayMessage = JSON.parse(rawDataToText(data));

        if (msg.type === "res" && msg.id) {
          const handler = pendingRequests.get(msg.id);
          if (handler) {
            pendingRequests.delete(msg.id);
            handler(msg);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("open", async () => {
      try {
        // Step 1: Connect/authenticate
        // Valid client IDs: webchat-ui, openclaw-control-ui, webchat, cli, gateway-client, etc.
        // Valid client modes: webchat, cli, ui, backend, node, probe, test
        const connectRes = await sendRequest(
          ws,
          pendingRequests,
          "connect",
          {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: "gateway-client",
            version: "1.0.0",
            platform: "server",
            mode: "backend",
          },
          auth: { token },
          },
          Math.min(timeoutMs, 15_000)
        );

        if (!connectRes.ok) {
          clearTimeout(timeout);
          ws.close();
          resolve({
            ok: false,
            error: connectRes.error?.message || "Authentication failed",
          });
          return;
        }

        connected = true;

        // Step 2: Execute the requested RPC method
        const rpcRes = await sendRequest(ws, pendingRequests, method, rpcParams, timeoutMs);

        clearTimeout(timeout);
        ws.close();

        if (!rpcRes.ok) {
          // Include full error details for debugging
          const errorMsg = rpcRes.error?.message || `${method} failed`;
          const errorDetails = rpcRes.error ? JSON.stringify(rpcRes.error) : undefined;
          console.log("[gatewayRpc] Error response:", errorMsg, errorDetails);
          resolve({
            ok: false,
            error: errorMsg,
          });
          return;
        }

        resolve({ ok: true, payload: rpcRes.payload as T });
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        resolve({ ok: false, error: `RPC error: ${String(err)}` });
      }
    });
  });
}

function sendRequest(
  ws: WebSocket,
  pendingRequests: Map<string, (res: GatewayMessage) => void>,
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<GatewayMessage> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Request timeout for ${method}`));
    }, Math.max(1000, timeoutMs));

    pendingRequests.set(id, (res) => {
      clearTimeout(timeout);
      resolve(res);
    });

    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

/**
 * Get chat history for a session from the gateway
 */
export async function getChatHistory(params: {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  limit?: number;
}): Promise<{ ok: boolean; messages?: ChatHistoryMessage[]; error?: string }> {
  const result = await gatewayRpc<ChatHistoryResult>({
    gatewayUrl: params.gatewayUrl,
    token: params.token,
    method: "chat.history",
    rpcParams: {
      sessionKey: params.sessionKey,
      limit: params.limit ?? 1000,
    },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, messages: result.payload?.messages ?? [] };
}

/**
 * Build a session key for the OpenAI-compatible endpoint
 * This matches the format used by the gateway's resolveOpenAiSessionKey
 */
export function buildSessionKey(userId: string, agentId: string = "main"): string {
  return `agent:${agentId}:openai-user:${userId}`;
}
