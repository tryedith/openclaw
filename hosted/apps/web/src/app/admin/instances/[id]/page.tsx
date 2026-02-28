"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Square, FileText, ChevronDown, ChevronUp, MessageCircle, Send, FolderOpen } from "lucide-react";
import { ChatMarkdown } from "@/app/dashboard/components/chat-markdown";
import { FileTree } from "@/app/dashboard/components/file-tree";
import { FileViewer } from "@/app/dashboard/components/file-viewer";
import type { FileNode } from "@/app/dashboard/types";

interface InstanceDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  public_url: string | null;
  aws_service_arn: string | null;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  created_at: string;
  last_health_at: string | null;
}

interface Channel {
  name: string;
  configured: boolean;
  linked: boolean;
  enabled: boolean;
}

interface Usage {
  totalCostUsd: number;
  totalRequests: number;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface HistoryMessageRaw {
  role: string;
  content: unknown;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

function extractTextContent(content: unknown, role?: string): string {
  const allowedTypes: ReadonlySet<string> =
    role === "user"
      ? new Set(["text", "input_text"])
      : role === "assistant"
      ? new Set(["text", "output_text"])
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
    const nested = content as { role?: unknown; content?: unknown };
    return extractTextContent(nested.content, typeof nested.role === "string" ? nested.role : role);
  }
  if (isTextBlock(content)) {return content.text;}
  return "";
}

export default function AdminInstanceDetailPage() {
  const params = useParams();
  const instanceId = params.id as string;

  const [instance, setInstance] = useState<InstanceDetail | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [usage, setUsage] = useState<Usage>({ totalCostUsd: 0, totalRequests: 0 });
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatMessage, setChatMessage] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatResetting, setChatResetting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Files state
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{ path: string; name: string; content: string; size: number; language: string } | null>(null);
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/admin/instances/${instanceId}`)
      .then((r) => r.json())
      .then((data) => {
        setInstance(data.instance);
        setChannels(data.channels ?? []);
        setUsage(data.usage ?? { totalCostUsd: 0, totalRequests: 0 });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [instanceId]);

  async function handleRestart() {
    setActionLoading(true);
    setActionMsg("");
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/restart`, { method: "POST" });
      const data = await res.json();
      setActionMsg(res.ok ? `Restart initiated (command: ${data.commandId})` : data.error || "Failed");
    } catch {
      setActionMsg("Error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setActionLoading(true);
    setActionMsg("");
    setConfirmStop(false);
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/stop`, { method: "POST" });
      const data = await res.json();
      setActionMsg(res.ok ? "Instance stopped" : data.error || "Failed");
      if (res.ok && instance) {
        setInstance({ ...instance, status: "stopped" });
      }
    } catch {
      setActionMsg("Error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFetchLogs() {
    setLogsOpen(!logsOpen);
    if (logs !== null || logsLoading) {return;}
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/logs`);
      const data = await res.json();
      setLogs(data.logs || "No logs available");
    } catch {
      setLogs("Failed to fetch logs");
    } finally {
      setLogsLoading(false);
    }
  }

  // Chat functions
  const fetchChatHistory = useCallback(async (showLoader?: boolean) => {
    if (showLoader) {setChatHistoryLoading(true);}
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/history`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const rawMessages: HistoryMessageRaw[] = Array.isArray(data.messages) ? data.messages : [];
        const messages: ChatMessage[] = rawMessages
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: extractTextContent(m.content, m.role),
          }))
          .filter((m) => m.content.length > 0);
        setChatHistory(messages);
      }
    } catch (err) {
      console.error("Error fetching chat history:", err);
    } finally {
      if (showLoader) {setChatHistoryLoading(false);}
    }
  }, [instanceId]);

  // Load history when chat opens
  useEffect(() => {
    if (chatOpen && instance?.status === "running") {
      void fetchChatHistory(true);
    }
  }, [chatOpen, instance?.status, fetchChatHistory]);

  // Poll while sending
  useEffect(() => {
    if (!chatSending || !chatOpen) {return;}
    pollTimerRef.current = setInterval(() => {
      void fetchChatHistory();
    }, 3000);
    return () => {
      if (pollTimerRef.current) {clearInterval(pollTimerRef.current);}
    };
  }, [chatSending, chatOpen, fetchChatHistory]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatSending]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {return;}
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [chatMessage]);

  async function handleSendMessage() {
    if (!chatMessage.trim() || chatSending) {return;}
    const msg = chatMessage;
    setChatMessage("");
    setChatSending(true);
    setChatHistory((prev) => [...prev, { role: "user", content: msg }]);

    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || data.details || `HTTP ${res.status}`);
      }
      // Poll will pick up the response; also fetch after a short delay
      setTimeout(() => void fetchChatHistory(), 800);
      // Keep polling for up to 60s, then give up
      setTimeout(() => setChatSending(false), 60000);
    } catch (err) {
      setChatSending(false);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Could not reach the bot"}` },
      ]);
    }
  }

  // Detect when assistant reply arrives during polling
  useEffect(() => {
    if (!chatSending) {return;}
    // If the last message is from assistant, stop sending state
    const last = chatHistory[chatHistory.length - 1];
    if (last?.role === "assistant") {
      setChatSending(false);
    }
  }, [chatHistory, chatSending]);

  async function handleResetChat() {
    if (chatResetting) {return;}
    setChatResetting(true);
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/chat/reset`, { method: "POST" });
      if (res.ok) {
        setChatHistory([]);
        setChatMessage("");
        setChatSending(false);
        void fetchChatHistory(true);
      }
    } catch (err) {
      console.error("Error resetting chat:", err);
    } finally {
      setChatResetting(false);
    }
  }

  // Files functions
  const fetchFileTree = useCallback(async () => {
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/files`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setFileTree(data.tree ?? []);
      }
    } catch (err) {
      console.error("Error fetching file tree:", err);
    } finally {
      setFilesLoading(false);
    }
  }, [instanceId]);

  async function handleSelectFile(path: string) {
    setSelectedFilePath(path);
    setFileContentLoading(true);
    try {
      const res = await fetch(`/api/admin/instances/${instanceId}/files/content?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setFileContent(data);
      } else {
        setFileContent(null);
      }
    } catch (err) {
      console.error("Error fetching file content:", err);
      setFileContent(null);
    } finally {
      setFileContentLoading(false);
    }
  }

  function handleToggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  // Load file tree when files panel opens
  useEffect(() => {
    if (filesOpen && instance?.status === "running" && fileTree.length === 0) {
      void fetchFileTree();
    }
  }, [filesOpen, instance?.status, fetchFileTree, fileTree.length]);

  if (loading) {return <div className="text-foreground-muted">Loading...</div>;}
  if (!instance) {return <div className="text-foreground-muted">Instance not found</div>;}

  return (
    <div className="space-y-6">
      <Link href="/admin/instances" className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Instances
      </Link>

      {/* Instance info */}
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`w-3 h-3 rounded-full ${STATUS_DOT[instance.status] || "bg-foreground-subtle"}`} />
              <h1 className="text-xl font-bold text-foreground">{instance.name}</h1>
              <span className="text-sm text-foreground-muted capitalize">{instance.status}</span>
            </div>
            {instance.description && <p className="text-sm text-foreground-muted mb-2">{instance.description}</p>}
            <div className="space-y-1 text-sm">
              <p className="text-foreground-muted">
                User: <Link href={`/admin/users/${instance.user_id}`} className="text-primary hover:underline">{instance.user_email}</Link>
              </p>
              {instance.aws_service_arn && <p className="text-foreground-muted">EC2: <span className="font-mono text-xs">{instance.aws_service_arn}</span></p>}
              {instance.public_url && <p className="text-foreground-muted">URL: <span className="font-mono text-xs">{instance.public_url}</span></p>}
              <p className="text-foreground-muted">Created: {new Date(instance.created_at).toLocaleString()}</p>
              {instance.last_health_at && <p className="text-foreground-muted">Last healthy: {new Date(instance.last_health_at).toLocaleString()}</p>}
            </div>
          </div>

          {/* Usage */}
          <div className="text-right">
            <p className="text-xs text-foreground-muted">Monthly Cost</p>
            <p className="text-lg font-bold text-foreground">${usage.totalCostUsd.toFixed(4)}</p>
            <p className="text-xs text-foreground-muted">{usage.totalRequests} requests</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleRestart}
            disabled={actionLoading || instance.status === "stopped"}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Restart
          </button>
          <button
            onClick={handleStop}
            disabled={actionLoading || instance.status === "stopped"}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              confirmStop
                ? "bg-error text-white hover:bg-error/90"
                : "border border-error text-error hover:bg-error/10"
            } disabled:opacity-50`}
          >
            <Square className="w-4 h-4" />
            {confirmStop ? "Confirm Stop" : "Stop"}
          </button>
          <button
            onClick={handleFetchLogs}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-background text-foreground text-sm font-medium hover:bg-background-secondary transition-colors"
          >
            <FileText className="w-4 h-4" />
            Logs
            {logsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {instance.status === "running" && (
            <>
              <button
                onClick={() => setChatOpen(!chatOpen)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  chatOpen
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-background-secondary"
                }`}
              >
                <MessageCircle className="w-4 h-4" />
                Chat
                {chatOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <button
                onClick={() => setFilesOpen(!filesOpen)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  filesOpen
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-background-secondary"
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                Files
                {filesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </>
          )}
          {actionMsg && <span className="text-sm text-foreground-muted">{actionMsg}</span>}
        </div>

        {/* Logs panel */}
        {logsOpen && (
          <div className="mt-4 rounded-xl bg-background border border-border p-4 max-h-96 overflow-auto">
            {logsLoading ? (
              <p className="text-sm text-foreground-muted">Fetching logs...</p>
            ) : (
              <pre className="text-xs text-foreground font-mono whitespace-pre-wrap">{logs}</pre>
            )}
          </div>
        )}
      </div>

      {/* Chat panel */}
      {chatOpen && instance.status === "running" && (
        <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden flex flex-col" style={{ height: "600px" }}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Chat with {instance.name}</h2>
            <button
              onClick={handleResetChat}
              disabled={chatResetting}
              className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors disabled:opacity-50"
            >
              {chatResetting ? "Resetting..." : "New Chat"}
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6">
            {chatHistoryLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-full border-3 border-primary-light border-t-primary animate-spin mb-4" />
                <p className="text-foreground-muted">Loading conversation...</p>
              </div>
            ) : chatHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-background flex items-center justify-center mb-4">
                  <MessageCircle className="w-8 h-8 text-foreground-subtle" />
                </div>
                <p className="text-foreground-muted font-medium">No conversation yet</p>
                <p className="text-sm text-foreground-subtle mt-1 max-w-sm">
                  Send a message to chat with this instance
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {chatHistory.map((msg, index) =>
                  msg.role === "system" ? (
                    <div key={index} className="flex justify-center">
                      <div className="max-w-[85%] rounded-full border border-border bg-background px-4 py-1.5 text-xs text-foreground-muted">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-white rounded-br-md"
                            : "bg-background border border-border text-foreground rounded-bl-md"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.content}</p>
                        ) : (
                          <ChatMarkdown content={msg.content} />
                        )}
                      </div>
                    </div>
                  )
                )}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="bg-background border border-border rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-3">
              <textarea
                ref={textareaRef}
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) {return;}
                  e.preventDefault();
                  void handleSendMessage();
                }}
                placeholder="Type a message... (Shift+Enter for line breaks)"
                rows={1}
                className="flex-1 resize-none overflow-y-auto px-4 py-3 rounded-xl bg-background border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
                disabled={chatSending}
              />
              <button
                onClick={handleSendMessage}
                disabled={chatSending || !chatMessage.trim()}
                className="px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Files panel */}
      {filesOpen && instance.status === "running" && (
        <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden flex" style={{ height: "600px" }}>
          {/* File tree sidebar */}
          <div className="w-72 border-r border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Workspace Files</h2>
              <button
                onClick={() => void fetchFileTree()}
                disabled={filesLoading}
                className="text-xs px-2 py-1 rounded-lg text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors disabled:opacity-50"
              >
                {filesLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filesLoading && fileTree.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-6 h-6 rounded-full border-2 border-primary-light border-t-primary animate-spin" />
                </div>
              ) : fileTree.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-8">No files found</p>
              ) : (
                <FileTree
                  nodes={fileTree}
                  selectedPath={selectedFilePath}
                  expandedDirs={expandedDirs}
                  onSelectFile={handleSelectFile}
                  onToggleDir={handleToggleDir}
                />
              )}
            </div>
          </div>

          {/* File viewer */}
          <div className="flex-1 flex flex-col min-w-0">
            <FileViewer
              path={fileContent?.path ?? null}
              name={fileContent?.name ?? null}
              content={fileContent?.content ?? null}
              size={fileContent?.size ?? null}
              language={fileContent?.language ?? null}
              loading={fileContentLoading}
            />
          </div>
        </div>
      )}

      {/* Channels */}
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Channels ({channels.length})</h2>
        {channels.length === 0 ? (
          <p className="text-sm text-foreground-muted">No channels connected</p>
        ) : (
          <div className="space-y-2">
            {channels.map((ch) => (
              <div key={ch.name} className="flex items-center justify-between py-2 px-3 rounded-xl bg-background">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${ch.linked ? "bg-success" : ch.enabled ? "bg-warning" : "bg-foreground-subtle"}`} />
                  <span className="text-sm font-medium text-foreground capitalize">{ch.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {ch.linked && <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Linked</span>}
                  {ch.enabled && !ch.linked && <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">Enabled</span>}
                  {ch.configured && !ch.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-foreground-subtle/10 text-foreground-muted">Configured</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
