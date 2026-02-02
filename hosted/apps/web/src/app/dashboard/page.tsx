"use client";

import { useEffect, useState, useRef } from "react";

interface Instance {
  id: string;
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  public_url: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function DashboardPage() {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchInstance();
  }, []);

  useEffect(() => {
    if (instance?.status === "provisioning") {
      const interval = setInterval(() => {
        fetchInstance();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [instance?.status, instance?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Load chat history when instance becomes running
  useEffect(() => {
    if (instance?.status === "running" && instance?.id && !historyLoaded) {
      fetchHistory(instance.id);
    }
  }, [instance?.status, instance?.id, historyLoaded]);

  async function fetchHistory(instanceId: string) {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/instances/${instanceId}/history`);
      if (response.ok) {
        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          // Convert gateway format to UI format, filtering out system/tool messages
          const messages: ChatMessage[] = data.messages
            .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
            .map((m: { role: string; content: unknown }) => ({
              role: m.role as "user" | "assistant",
              content: extractTextContent(m.content),
            }))
            .filter((m: ChatMessage) => m.content.length > 0);
          setChatHistory(messages);
        }
      }
    } catch (error) {
      console.error("Error fetching chat history:", error);
    } finally {
      setHistoryLoading(false);
      setHistoryLoaded(true);
    }
  }

  // Extract text from message content (handles both string and content block array)
  function extractTextContent(content: unknown): string {
    // Simple string content
    if (typeof content === "string") {
      return content;
    }
    // Array of content blocks (e.g., [{type: "text", text: "..."}, {type: "thinking", ...}])
    if (Array.isArray(content)) {
      return content
        .filter((block): block is { type: string; text: string } =>
          block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
        )
        .map((block) => block.text)
        .join("\n");
    }
    // Single content block object
    if (content && typeof content === "object" && "type" in content && "text" in content) {
      const block = content as { type: string; text: string };
      if (block.type === "text") {
        return block.text;
      }
    }
    return "";
  }

  async function fetchInstance() {
    try {
      const response = await fetch("/api/instances");
      const data = await response.json();
      if (data.instances && data.instances.length > 0) {
        setInstance(data.instances[0]);
      }
    } catch (error) {
      console.error("Error fetching instance:", error);
    } finally {
      setLoading(false);
    }
  }

  async function createInstance() {
    setCreating(true);
    try {
      const response = await fetch("/api/instances", { method: "POST" });
      const data = await response.json();
      if (data.id) {
        setInstance({ id: data.id, status: "provisioning", public_url: null });
      } else if (data.error) {
        alert("Error: " + data.error);
      }
    } catch (error) {
      console.error("Error creating instance:", error);
    } finally {
      setCreating(false);
    }
  }

  async function deleteInstance() {
    if (!instance) return;
    if (!confirm("Are you sure you want to cancel? This will delete the bot.")) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" });
      if (response.ok) {
        setInstance(null);
        setChatHistory([]);
        setHistoryLoaded(false);
      }
    } catch (error) {
      console.error("Error deleting instance:", error);
    } finally {
      setDeleting(false);
    }
  }

  async function sendMessage() {
    if (!message.trim() || !instance?.id || instance.status !== "running" || sending) return;

    const userMessage = message.trim();
    setMessage("");
    setSending(true);
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const response = await fetch(`/api/instances/${instance.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();
      if (data.error) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", content: data.response || "No response" }]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setChatHistory((prev) => [...prev, { role: "assistant", content: "Error: Could not reach the bot" }]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
          <p className="text-foreground-muted">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // No instance - show create bot UI
  if (!instance) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-primary-light flex items-center justify-center mb-6">
            <RocketIcon className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Create your AI assistant</h1>
          <p className="text-foreground-muted mb-8">
            Get started by creating your personal bot instance. It only takes a minute.
          </p>
          <button
            onClick={createInstance}
            disabled={creating}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-white font-semibold text-lg hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/25"
          >
            {creating ? (
              <>
                <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <SparklesIcon className="w-5 h-5" />
                Create Bot
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Provisioning state
  if (instance.status === "provisioning") {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary-light flex items-center justify-center mb-6">
            <div className="w-8 h-8 rounded-full border-3 border-primary border-t-transparent animate-spin" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Setting up your assistant</h1>
          <p className="text-foreground-muted mb-8">
            This usually takes 2-3 minutes. You can wait here or come back later.
          </p>
          <button
            onClick={deleteInstance}
            disabled={deleting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-foreground-muted hover:text-error hover:bg-error-light transition-colors text-sm"
          >
            <TrashIcon className="w-4 h-4" />
            {deleting ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (instance.status === "error") {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-error-light flex items-center justify-center mb-6">
            <AlertIcon className="w-8 h-8 text-error" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Something went wrong</h1>
          <p className="text-foreground-muted mb-8">
            Your bot failed to start. Please delete and try again.
          </p>
          <button
            onClick={deleteInstance}
            disabled={deleting}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-error text-white font-semibold hover:bg-error-dark active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {deleting ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <TrashIcon className="w-4 h-4" />
                Delete & Retry
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Running - show chat interface as main UI
  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <ChatIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Chat</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm text-foreground-muted">Bot is running</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-background-secondary rounded-2xl border border-border overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {historyLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-full border-3 border-primary-light border-t-primary animate-spin mb-4" />
              <p className="text-foreground-muted">Loading conversation...</p>
            </div>
          ) : chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-background flex items-center justify-center mb-4">
                <MessageIcon className="w-8 h-8 text-foreground-subtle" />
              </div>
              <p className="text-foreground-muted font-medium">Start a conversation</p>
              <p className="text-sm text-foreground-subtle mt-1 max-w-sm">
                Send a message to chat with your AI assistant
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-background border border-border text-foreground rounded-bl-md"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {sending && (
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
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-3 rounded-xl bg-background border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
              disabled={sending}
              autoFocus
            />
            <button
              onClick={sendMessage}
              disabled={sending || !message.trim()}
              className="px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <SendIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}
