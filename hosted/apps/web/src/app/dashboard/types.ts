export interface Instance {
  id: string;
  name: string;
  description?: string | null;
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  public_url: string | null;
  created_at?: string;
  channels?: Array<{
    id: string;
    channel_type: string;
    status: string;
    linked_identity?: string;
  }>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface HistoryMessageRaw {
  role: string;
  content: unknown;
  timestamp?: number;
}

export type ProviderId = "anthropic" | "openai" | "google";

export interface ProviderModel {
  id: string;
  name: string;
  modelRef: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
}

export interface ProviderModelGroup {
  provider: ProviderId;
  label: string;
  models: ProviderModel[];
}

export type GatewayFrame =
  | {
      type: "event";
      event: string;
      payload?: unknown;
    }
  | {
      type: "res";
      id: string;
      ok: boolean;
      payload?: unknown;
      error?: { message?: string };
    };

export type ChatEventPayload = {
  runId?: string;
  sessionKey?: string;
  state?: "delta" | "final" | "aborted" | "error" | "notice";
  noticeType?: string;
  message?: unknown;
  noticeMessage?: string;
  errorMessage?: string;
};
