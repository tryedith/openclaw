"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Key, Check, Trash2, Loader2 } from "lucide-react";
import type { InstanceApiKeyStatus, ApiKeyProvider } from "../../../types";

const PROVIDERS: { id: ApiKeyProvider; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-proj-..." },
  { id: "google", label: "Google (Gemini)", placeholder: "AIza..." },
];

export default function InstanceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [keys, setKeys] = useState<InstanceApiKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<ApiKeyProvider | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState<ApiKeyProvider | null>(null);
  const [removing, setRemoving] = useState<ApiKeyProvider | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function fetchKeys() {
    try {
      const res = await fetch(`/api/instances/${id}/api-keys`);
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchKeys();
  }, [id]);

  async function handleSave(provider: ApiKeyProvider) {
    if (!keyInput.trim()) {return;}

    setSaving(provider);
    setMessage(null);

    try {
      const res = await fetch(`/api/instances/${id}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: keyInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setMessage({ type: "error", text: data.error || "Failed to save key" });
        return;
      }

      setMessage({
        type: "success",
        text: res.status === 207
          ? data.error
          : `${PROVIDERS.find((p) => p.id === provider)?.label} key saved. Container restarting (~15s)...`,
      });
      setEditingProvider(null);
      setKeyInput("");
      await fetchKeys();
    } catch {
      setMessage({ type: "error", text: "Failed to save key" });
    } finally {
      setSaving(null);
    }
  }

  async function handleRemove(provider: ApiKeyProvider) {
    setRemoving(provider);
    setMessage(null);

    try {
      const res = await fetch(`/api/instances/${id}/api-keys`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (res.ok) {
        setMessage({
          type: "success",
          text: `${PROVIDERS.find((p) => p.id === provider)?.label} key removed. Reverting to platform key...`,
        });
        await fetchKeys();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to remove key" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to remove key" });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="text-foreground-muted hover:text-foreground text-sm"
            >
              Instances
            </Link>
            <span className="text-foreground-subtle text-sm">/</span>
            <Link
              href={`/dashboard/instances/${id}`}
              className="text-foreground-muted hover:text-foreground text-sm"
            >
              Chat
            </Link>
            <span className="text-foreground-subtle text-sm">/</span>
            <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          </div>
          <p className="text-sm text-foreground-muted mt-0.5">
            Manage API keys for this instance
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-xl border ${
            message.type === "success"
              ? "bg-success-light border-success/30 text-success-dark"
              : "bg-error-light border-error/30 text-error-dark"
          }`}
        >
          <p className="text-sm font-medium">{message.text}</p>
        </div>
      )}

      <div className="bg-background-secondary rounded-2xl border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-foreground-muted" />
            <h2 className="text-lg font-semibold text-foreground">API Keys</h2>
          </div>
          <p className="text-sm text-foreground-muted mt-1">
            Provide your own API keys to use your account with each provider.
            When no key is set, the platform key is used.
          </p>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {PROVIDERS.map((provider) => {
              const keyStatus = keys.find((k) => k.provider === provider.id);
              const hasKey = keyStatus?.hasKey ?? false;
              const isEditing = editingProvider === provider.id;
              const isSaving = saving === provider.id;
              const isRemoving = removing === provider.id;

              return (
                <div key={provider.id} className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {provider.label}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          hasKey
                            ? "bg-success-light text-success-dark"
                            : "bg-background text-foreground-muted border border-border"
                        }`}
                      >
                        {hasKey ? "Your Key" : "Platform Key"}
                      </span>
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-2">
                        {hasKey && (
                          <button
                            onClick={() => handleRemove(provider.id)}
                            disabled={isRemoving || isSaving}
                            className="px-3 py-1.5 text-xs rounded-lg border border-border text-foreground-muted hover:text-error hover:border-error/30 transition-colors disabled:opacity-50"
                          >
                            {isRemoving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingProvider(provider.id);
                            setKeyInput("");
                            setMessage(null);
                          }}
                          disabled={isSaving || isRemoving}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
                        >
                          {hasKey ? "Change" : "Add Key"}
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mt-4 flex gap-2">
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={provider.placeholder}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {void handleSave(provider.id);}
                          if (e.key === "Escape") {
                            setEditingProvider(null);
                            setKeyInput("");
                          }
                        }}
                      />
                      <button
                        onClick={() => handleSave(provider.id)}
                        disabled={!keyInput.trim() || isSaving}
                        className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingProvider(null);
                          setKeyInput("");
                        }}
                        disabled={isSaving}
                        className="px-4 py-2.5 rounded-xl border border-border text-sm text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
