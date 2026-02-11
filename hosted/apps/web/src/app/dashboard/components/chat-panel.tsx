import { useEffect, useRef } from "react";

import { MessageIcon, SendIcon } from "../icons";
import type { ChatMessage } from "../types";

export function ChatPanel({
  historyLoading,
  chatHistory,
  sending,
  streamingAssistant,
  message,
  onMessageChange,
  onSend,
}: {
  historyLoading: boolean;
  chatHistory: ChatMessage[];
  sending: boolean;
  streamingAssistant: string;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, sending, streamingAssistant]);

  return (
    <>
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
            {chatHistory.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
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
            {sending ? (
              <div className="flex justify-start">
                <div className="bg-background border border-border rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
                  {streamingAssistant ? (
                    <p className="text-sm whitespace-pre-wrap">{streamingAssistant}</p>
                  ) : (
                    <div className="flex gap-1">
                      <span
                        className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-2 h-2 bg-foreground-subtle rounded-full animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex gap-3">
          <input
            type="text"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && onSend()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 rounded-xl bg-background border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
            disabled={sending}
            autoFocus
          />
          <button
            onClick={onSend}
            disabled={sending || !message.trim()}
            className="px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
}
