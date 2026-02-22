import { useEffect, useRef, useState } from "react";

import {
  GATEWAY_PROTOCOL_VERSION,
  HISTORY_FALLBACK_POLL_INTERVAL_MS,
  LIVE_RECONNECT_MS,
} from "./constants";
import type {
  ChatEventPayload,
  ChatMessage,
  GatewayFrame,
  HistoryMessageRaw,
  Instance,
  ProviderId,
  ProviderModelGroup,
} from "./types";

const MODEL_RESTART_GRACE_MS = 20_000;
const MODEL_RELOAD_RETRY_MS = 1_500;
const MODEL_RELOAD_MAX_ATTEMPTS = 12;
const MODEL_POST_RESTART_STABILIZE_MS = 1_000;

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isSameChatHistory(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) {return false;}
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.role !== b[i]?.role || a[i]?.content !== b[i]?.content) {
      return false;
    }
  }
  return true;
}

function extractTextContent(
  content: unknown,
  role?: "user" | "assistant" | "system"
): string {
  const allowedTypes: ReadonlySet<string> =
    role === "user"
      ? new Set(["text", "input_text"])
      : role === "assistant"
      ? new Set(["text", "output_text"])
      : role === "system"
      ? new Set(["text"])
      : new Set(["text", "input_text", "output_text"]);

  const isTextBlock = (value: unknown): value is { type: string; text: string } =>
    Boolean(
      value &&
        typeof value === "object" &&
        "type" in value &&
        "text" in value &&
        typeof (value as { text?: unknown }).text === "string" &&
        allowedTypes.has(String((value as { type?: unknown }).type))
    );

  if (typeof content === "string") {return content;}

  if (Array.isArray(content)) {
    return content.filter(isTextBlock).map((block) => block.text).join("\n");
  }

  if (content && typeof content === "object" && "content" in content) {
    const withContent = content as { role?: unknown; content?: unknown };
    const nestedRole =
      withContent.role === "user" || withContent.role === "assistant" || withContent.role === "system"
        ? (withContent.role)
        : role;
    return extractTextContent(withContent.content, nestedRole);
  }

  if (isTextBlock(content)) {return content.text;}
  return "";
}

function parseProviderFromModelRef(modelRef: string): ProviderId | null {
  const slash = modelRef.indexOf("/");
  if (slash <= 0) {return null;}
  const provider = modelRef.slice(0, slash) as ProviderId;
  return provider === "anthropic" || provider === "openai" || provider === "google"
    ? provider
    : null;
}

function updateModelSelectionFromCurrent(
  groups: ProviderModelGroup[],
  modelRef: string
): { provider: ProviderId; modelRef: string } | null {
  const fromRef = parseProviderFromModelRef(modelRef);
  if (fromRef) {
    const group = groups.find((entry) => entry.provider === fromRef);
    if (group) {
      const exact = group.models.find((model) => model.modelRef === modelRef);
      if (exact) {return { provider: fromRef, modelRef: exact.modelRef };}
      if (group.models[0]) {return { provider: fromRef, modelRef: group.models[0].modelRef };}
    }
  }

  const firstGroup = groups[0];
  if (!firstGroup || !firstGroup.models[0]) {return null;}
  return { provider: firstGroup.provider, modelRef: firstGroup.models[0].modelRef };
}

function shouldPreserveInFlightHistory(
  prev: ChatMessage[],
  next: ChatMessage[],
  hasInFlightRun: boolean
): boolean {
  if (!hasInFlightRun) {return false;}
  return next.length < prev.length;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw) {return null;}
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useDashboardChat(instanceId: string) {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [startingNewChat, setStartingNewChat] = useState(false);

  const [liveConnected, setLiveConnected] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelMessage, setModelMessage] = useState<string | null>(null);
  const [modelRestarting, setModelRestarting] = useState(false);
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [currentModelRef, setCurrentModelRef] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("anthropic");
  const [selectedModelRef, setSelectedModelRef] = useState("");

  const liveSocketRef = useRef<WebSocket | null>(null);
  const historySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRestartClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRestartUntilRef = useRef<number>(0);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunStartedAtRef = useRef<number | null>(null);
  const assistantCountAtRunStartRef = useRef<number | null>(null);

  function clearPendingRunState(opts?: { preserveStream?: boolean }) {
    setSending(false);
    if (!opts?.preserveStream) {
      setStreamingAssistant(null);
    }
    setActiveRunId(null);
    activeRunIdRef.current = null;
    activeRunStartedAtRef.current = null;
    assistantCountAtRunStartRef.current = null;
  }

  function clearConversationState() {
    setHistoryLoaded(false);
    setChatHistory([]);
    setMessage("");
    clearPendingRunState();
  }

  function clearModelReloadTimer() {
    if (modelReloadTimerRef.current) {
      clearTimeout(modelReloadTimerRef.current);
      modelReloadTimerRef.current = null;
    }
  }

  function clearModelRestartClearTimer() {
    if (modelRestartClearTimerRef.current) {
      clearTimeout(modelRestartClearTimerRef.current);
      modelRestartClearTimerRef.current = null;
    }
  }

  function scheduleModelRestartClear() {
    clearModelRestartClearTimer();
    const remainingMs = Math.max(0, modelRestartUntilRef.current - Date.now());
    modelRestartClearTimerRef.current = setTimeout(() => {
      setModelRestarting(false);
      modelRestartClearTimerRef.current = null;
    }, remainingMs + MODEL_POST_RESTART_STABILIZE_MS);
  }

  function inModelRestartGrace(): boolean {
    return Date.now() < modelRestartUntilRef.current;
  }

  function beginModelRestartGrace() {
    modelRestartUntilRef.current = Date.now() + MODEL_RESTART_GRACE_MS;
    setModelRestarting(true);
    setModelMessage("Model updated. Gateway restarting; reconnecting...");
    scheduleModelRestartClear();
  }

  function clearModelState() {
    clearModelReloadTimer();
    clearModelRestartClearTimer();
    modelRestartUntilRef.current = 0;
    setModelRestarting(false);
    setProviderGroups([]);
    setCurrentModelRef("");
    setSelectedProvider("anthropic");
    setSelectedModelRef("");
    setModelsError(null);
    setModelMessage(null);
  }

  async function fetchInstance() {
    try {
      const response = await fetch("/api/instances");
      const data = await response.json();
      const instances = (data.instances as Instance[]) || [];
      const found = instances.find((inst) => inst.id === instanceId);
      setInstance(found || null);
    } catch (error) {
      console.error("Error fetching instance:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory(instId: string, opts?: { showLoader?: boolean }) {
    const showLoader = opts?.showLoader === true;
    if (showLoader) {
      setHistoryLoading(true);
    }

    try {
      const response = await fetch(`/api/instances/${instId}/history`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        const rawMessages: HistoryMessageRaw[] = Array.isArray(data.messages)
          ? (data.messages as HistoryMessageRaw[])
          : [];

        const messages: ChatMessage[] = rawMessages
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: extractTextContent(m.content, m.role as "user" | "assistant" | "system"),
          }))
          .filter((m) => m.content.length > 0);

        const hasInFlightRun = activeRunIdRef.current != null || activeRunStartedAtRef.current != null;
        setChatHistory((prev) => {
          if (isSameChatHistory(prev, messages)) {return prev;}
          if (shouldPreserveInFlightHistory(prev, messages, hasInFlightRun)) {return prev;}
          return messages;
        });

        const runStartedAt = activeRunStartedAtRef.current;
        if (runStartedAt != null) {
          const hasTimestampedAssistantAfterRunStart = rawMessages.some(
            (msg) =>
              msg.role === "assistant" &&
              typeof msg.timestamp === "number" &&
              msg.timestamp >= runStartedAt
          );
          const assistantCount = messages.reduce(
            (count, msg) => count + (msg.role === "assistant" ? 1 : 0),
            0
          );
          const baselineAssistantCount = assistantCountAtRunStartRef.current;
          const hasNewAssistantSinceRunStart =
            typeof baselineAssistantCount === "number" && assistantCount > baselineAssistantCount;

          if (hasTimestampedAssistantAfterRunStart || hasNewAssistantSinceRunStart) {
            clearPendingRunState();
          }
        }
      }
    } catch (error) {
      console.error("Error fetching chat history:", error);
    } finally {
      if (showLoader) {
        setHistoryLoading(false);
      }
      setHistoryLoaded(true);
    }
  }

  async function fetchModels(instId: string): Promise<boolean> {
    setModelsLoading(true);
    setModelsError(null);

    try {
      const response = await fetch(`/api/instances/${instId}/models`, {
        cache: "no-store",
      });
      const data = (await readJsonResponse<{
        error?: string;
        currentModelRef?: string;
        providers?: ProviderModelGroup[];
      }>(response)) ?? { error: response.ok ? "Invalid response payload" : undefined };

      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const groups = Array.isArray(data.providers) ? data.providers : [];
      const current = typeof data.currentModelRef === "string" ? data.currentModelRef : "";
      setProviderGroups(groups);
      setCurrentModelRef(current);
      setModelMessage(null);

      const nextSelection = updateModelSelectionFromCurrent(groups, current);
      if (nextSelection) {
        setSelectedProvider(nextSelection.provider);
        setSelectedModelRef(nextSelection.modelRef);
      }
      if (inModelRestartGrace()) {
        scheduleModelRestartClear();
      } else {
        setModelRestarting(false);
        clearModelRestartClearTimer();
      }
    } catch (error) {
      if (inModelRestartGrace()) {
        setModelMessage("Gateway restarting; reconnecting...");
        return false;
      }
      setModelsError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setModelsLoading(false);
    }
    return true;
  }

  function scheduleModelReload(instId: string, attemptsLeft: number) {
    clearModelReloadTimer();
    modelReloadTimerRef.current = setTimeout(() => {
      void fetchModels(instId).then((ok) => {
        if (ok) {
          clearModelReloadTimer();
          return;
        }
        if (attemptsLeft > 1) {
          scheduleModelReload(instId, attemptsLeft - 1);
          return;
        }
        if (inModelRestartGrace()) {
          scheduleModelReload(instId, 1);
          return;
        }
        setModelRestarting(false);
      });
    }, MODEL_RELOAD_RETRY_MS);
  }

  async function sendMessage() {
    if (
      !message.trim() ||
      !instance?.id ||
      instance.status !== "running" ||
      sending ||
      modelRestarting
    ) {return;}

    const userMessage = message;
    setMessage("");
    setSending(true);
    setStreamingAssistant(null);
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    activeRunStartedAtRef.current = Date.now();
    assistantCountAtRunStartRef.current = chatHistory.reduce(
      (count, msg) => count + (msg.role === "assistant" ? 1 : 0),
      0
    );

    try {
      const response = await fetch(`/api/instances/${instance.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = (await response.json()) as {
        error?: string;
        details?: string;
        runId?: string;
        status?: string;
      };
      if (!response.ok || data.error) {
        throw new Error(data.error || data.details || `HTTP ${response.status}`);
      }

      if (typeof data.runId === "string" && data.runId) {
        setActiveRunId(data.runId);
        activeRunIdRef.current = data.runId;
        setTimeout(() => {
          void fetchHistory(instance.id);
        }, 600);
      } else {
        clearPendingRunState();
        void fetchHistory(instance.id);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      if (inModelRestartGrace()) {
        setMessage(userMessage);
        setModelMessage("Gateway restarting; reconnecting...");
        clearPendingRunState();
        return;
      }
      clearPendingRunState();
      setChatHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Could not reach the bot"}`,
        },
      ]);
    }
  }

  async function saveSelectedModel() {
    if (!instance?.id || !selectedModelRef || modelSaving) {return;}

    setModelSaving(true);
    setModelsError(null);
    setModelMessage(null);

    try {
      const response = await fetch(`/api/instances/${instance.id}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRef: selectedModelRef }),
      });
      const data = (await readJsonResponse<{
        error?: string;
        modelRef?: string;
        restart?: { scheduled?: boolean };
      }>(response)) ?? { error: response.ok ? "Invalid response payload" : undefined };

      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const appliedRef = typeof data.modelRef === "string" ? data.modelRef : selectedModelRef;
      setCurrentModelRef(appliedRef);
      beginModelRestartGrace();
      scheduleModelReload(instance.id, MODEL_RELOAD_MAX_ATTEMPTS);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelSaving(false);
    }
  }

  async function startNewChat() {
    if (!instance?.id || instance.status !== "running" || startingNewChat) {return;}

    setStartingNewChat(true);
    try {
      const response = await fetch(`/api/instances/${instance.id}/chat/reset`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; details?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error || data.details || `HTTP ${response.status}`);
      }

      setMessage("");
      clearPendingRunState();
      setChatHistory([]);
      void fetchHistory(instance.id, { showLoader: true });
    } catch (error) {
      console.error("Error starting new chat:", error);
    } finally {
      setStartingNewChat(false);
    }
  }

  // Fetch instance on mount or when instanceId changes
  useEffect(() => {
    clearConversationState();
    clearModelState();
    setLoading(true);
    void fetchInstance();
  }, [instanceId]);

  // Poll for provisioning status
  useEffect(() => {
    if (instance?.status !== "provisioning") {return;}

    const interval = setInterval(() => {
      void fetchInstance();
    }, 3000);

    return () => clearInterval(interval);
  }, [instance?.status, instance?.id]);

  // Load history when instance becomes running
  useEffect(() => {
    if (instance?.status === "running" && instance?.id && !historyLoaded) {
      void fetchHistory(instance.id, { showLoader: true });
    }
  }, [instance?.status, instance?.id, historyLoaded]);

  // Load models when instance becomes running
  useEffect(() => {
    if (instance?.status === "running" && instance?.id) {
      void fetchModels(instance.id);
    }
  }, [instance?.status, instance?.id]);

  // Sync selected model when provider changes
  useEffect(() => {
    const group = providerGroups.find((entry) => entry.provider === selectedProvider);
    if (!group || group.models.length === 0) {return;}
    if (!group.models.some((model) => model.modelRef === selectedModelRef)) {
      setSelectedModelRef(group.models[0].modelRef);
    }
  }, [providerGroups, selectedProvider, selectedModelRef]);

  // Fallback polling for history
  useEffect(() => {
    if (instance?.status !== "running" || !instance?.id || !historyLoaded || liveConnected) {return;}

    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") {return;}
      void fetchHistory(instance.id);
    }, HISTORY_FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [instance?.status, instance?.id, historyLoaded, liveConnected]);

  // Keep history synchronized while a run is in-flight
  useEffect(() => {
    if (instance?.status !== "running" || !instance?.id || !sending) {return;}

    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") {return;}
      void fetchHistory(instance.id);
    }, 3000);

    return () => clearInterval(interval);
  }, [instance?.status, instance?.id, sending]);

  // WebSocket live connection
  useEffect(() => {
    if (instance?.status !== "running" || !instance?.id) {return;}

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectRequestId: string | null = null;
    const instId = instance.id;

    const closeSocket = () => {
      const ws = liveSocketRef.current;
      liveSocketRef.current = null;
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    };

    const scheduleHistoryRefresh = () => {
      if (historySyncTimerRef.current) {return;}
      historySyncTimerRef.current = setTimeout(() => {
        historySyncTimerRef.current = null;
        if (!cancelled) {
          void fetchHistory(instId);
        }
      }, 150);
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) {return;}
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectLiveSocket();
      }, LIVE_RECONNECT_MS);
    };

    const connectLiveSocket = async () => {
      closeSocket();
      setLiveConnected(false);

      try {
        const controlUrlResponse = await fetch(`/api/instances/${instId}/control-url`, {
          cache: "no-store",
        });
        if (!controlUrlResponse.ok) {
          const errorPayload = await readJsonResponse<{ error?: string; details?: string }>(
            controlUrlResponse
          );
          const detail = errorPayload?.error || errorPayload?.details;
          setLiveError(
            detail
              ? `${detail} (${controlUrlResponse.status})`
              : `Control URL request failed (${controlUrlResponse.status})`
          );
          scheduleReconnect();
          return;
        }

        const controlData =
          (await readJsonResponse<{ url?: string }>(controlUrlResponse)) ?? {};
        if (!controlData.url || cancelled) {
          setLiveError("Missing gateway control URL");
          scheduleReconnect();
          return;
        }

        const parsedUrl = new URL(controlData.url);
        const token = parsedUrl.searchParams.get("token");
        parsedUrl.search = "";
        if (!token) {
          setLiveError("Missing gateway auth token");
          scheduleReconnect();
          return;
        }

        const wsUrl = parsedUrl
          .toString()
          .replace(/^http:/, "ws:")
          .replace(/^https:/, "wss:")
          .replace(/\/$/, "");

        const safeWsUrl =
          typeof window !== "undefined" && window.location.protocol === "https:"
            ? wsUrl.replace(/^ws:/, "wss:")
            : wsUrl;

        const ws = new WebSocket(safeWsUrl);
        liveSocketRef.current = ws;

        ws.addEventListener("open", () => {
          if (cancelled) {return;}
          connectRequestId = generateRequestId();
          ws.send(
            JSON.stringify({
              type: "req",
              id: connectRequestId,
              method: "connect",
              params: {
                minProtocol: GATEWAY_PROTOCOL_VERSION,
                maxProtocol: GATEWAY_PROTOCOL_VERSION,
                client: {
                  id: "webchat-ui",
                  version: "hosted-web-1.0.0",
                  platform: "browser",
                  mode: "webchat",
                },
                auth: { token },
              },
            })
          );
        });

        ws.addEventListener("message", (event) => {
          let frame: GatewayFrame;
          try {
            frame = JSON.parse(event.data as string) as GatewayFrame;
          } catch {
            return;
          }

          if (frame.type === "res") {
            if (connectRequestId && frame.id === connectRequestId) {
              if (!frame.ok) {
                setLiveConnected(false);
                setLiveError(frame.error?.message || "Gateway connect failed");
                ws.close();
                return;
              }
              setLiveConnected(true);
              setLiveError(null);
              scheduleHistoryRefresh();
            }
            return;
          }

          if (frame.type === "event" && frame.event === "chat") {
            const payload =
              frame.payload && typeof frame.payload === "object"
                ? (frame.payload as ChatEventPayload)
                : undefined;
            const state = payload?.state;
            const runId = typeof payload?.runId === "string" ? payload.runId : null;

            if (state === "delta") {
              const currentRunId = activeRunIdRef.current;
              const canAdoptInFlightRun =
                !currentRunId && typeof runId === "string" && runId.length > 0;
              const isCurrentRun =
                typeof runId === "string" && runId.length > 0 && currentRunId === runId;
              const canRenderDelta = isCurrentRun || canAdoptInFlightRun;

              if (canAdoptInFlightRun && runId) {
                activeRunIdRef.current = runId;
                activeRunStartedAtRef.current = Date.now();
                setActiveRunId(runId);
              }

              if (canRenderDelta) {
                const text = extractTextContent(payload?.message);
                if (text) {setStreamingAssistant(text);}
                setSending(true);
                return;
              }
            }

            if (state === "notice") {
              const text =
                extractTextContent(payload?.message) ||
                (typeof payload?.noticeMessage === "string" ? payload.noticeMessage : "");
              const content = text.trim();
              if (!content) {return;}
              setChatHistory((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "system" && last.content === content) {return prev;}
                return [...prev, { role: "system", content }];
              });
              return;
            }

            if (state === "final" || state === "error" || state === "aborted") {
              const isCurrentRun =
                (runId && activeRunIdRef.current === runId) || (!runId && activeRunIdRef.current);
              if (isCurrentRun) {
                if (state === "final") {
                  // Keep the last streamed text visible until history sync lands the final message.
                  clearPendingRunState({ preserveStream: true });
                } else {
                  clearPendingRunState();
                }
              }
              scheduleHistoryRefresh();
            }
          }
        });

        ws.addEventListener("error", () => {
          // Handled by onclose.
        });

        ws.addEventListener("close", (closeEvent) => {
          if (liveSocketRef.current === ws) {
            liveSocketRef.current = null;
          }
          setLiveConnected(false);
          if (!cancelled) {
            const reason = closeEvent.reason || "no reason";
            setLiveError(`disconnected (${closeEvent.code}): ${reason}`);
            scheduleReconnect();
          }
        });
      } catch (error) {
        setLiveConnected(false);
        setLiveError(`Error connecting live chat updates: ${String(error)}`);
        scheduleReconnect();
      }
    };

    void connectLiveSocket();

    return () => {
      cancelled = true;
      setLiveConnected(false);
      setLiveError(null);
      clearModelReloadTimer();
      clearModelRestartClearTimer();
      if (reconnectTimer) {clearTimeout(reconnectTimer);}
      if (historySyncTimerRef.current) {
        clearTimeout(historySyncTimerRef.current);
        historySyncTimerRef.current = null;
      }
      closeSocket();
    };
  }, [instance?.status, instance?.id]);

  const selectedProviderModels =
    providerGroups.find((entry) => entry.provider === selectedProvider)?.models ?? [];
  const canSaveModel =
    selectedModelRef.length > 0 &&
    !modelSaving &&
    !modelRestarting &&
    !modelsLoading &&
    selectedModelRef !== currentModelRef;

  const sendingEffective = sending || modelRestarting;

  return {
    instance,
    loading,
    message,
    setMessage,
    chatHistory,
    sending: sendingEffective,
    streamingAssistant,
    activeRunId,
    startingNewChat,
    liveConnected,
    liveError,
    historyLoading,
    modelsLoading,
    modelsError,
    modelSaving,
    modelMessage,
    providerGroups,
    currentModelRef,
    selectedProvider,
    setSelectedProvider,
    selectedModelRef,
    setSelectedModelRef,
    selectedProviderModels,
    canSaveModel,
    sendMessage,
    startNewChat,
    saveSelectedModel,
  };
}
