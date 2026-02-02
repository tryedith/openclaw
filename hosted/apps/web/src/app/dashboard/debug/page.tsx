"use client";

import { useEffect, useState } from "react";

interface Instance {
  id: string;
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  public_url: string | null;
}

export default function DebugPage() {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchInstance();
  }, []);

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

  async function deleteInstance() {
    if (!instance) return;
    if (!confirm("Are you sure you want to delete this bot? This cannot be undone.")) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" });
      if (response.ok) {
        setInstance(null);
        window.location.href = "/dashboard";
      }
    } catch (error) {
      console.error("Error deleting instance:", error);
    } finally {
      setDeleting(false);
    }
  }

  async function openControlUI() {
    if (!instance) return;
    try {
      const response = await fetch(`/api/instances/${instance.id}/control-url`);
      const data = await response.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        alert("Could not get Control UI URL: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error getting control URL:", error);
      alert("Error opening Control UI");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
          <p className="text-foreground-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Debug</h1>
          <p className="mt-1 text-foreground-muted">Bot details and troubleshooting</p>
        </div>

        <div className="mt-8 bg-background-secondary rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-background flex items-center justify-center mb-4">
            <BugIcon className="w-8 h-8 text-foreground-subtle" />
          </div>
          <p className="text-foreground-muted">No bot instance found</p>
          <p className="text-sm text-foreground-subtle mt-1">Create a bot from the Dashboard first</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Debug</h1>
        <p className="mt-1 text-foreground-muted">Bot details and troubleshooting</p>
      </div>

      {/* Bot Status */}
      <div className="bg-background-secondary rounded-2xl border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
              <BotIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground">Bot Instance</h2>
              <p className="text-sm text-foreground-muted">Technical details</p>
            </div>
            <StatusBadge status={instance.status} />
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Instance ID */}
          <div>
            <label className="block text-sm font-medium text-foreground-muted mb-2">Instance ID</label>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-background border border-border">
              <code className="flex-1 font-mono text-sm text-foreground">{instance.id}</code>
              <button
                onClick={() => navigator.clipboard.writeText(instance.id)}
                className="p-2 rounded-lg hover:bg-background-secondary transition-colors"
                title="Copy"
              >
                <CopyIcon className="w-4 h-4 text-foreground-muted" />
              </button>
            </div>
          </div>

          {/* Bot URL */}
          {instance.public_url && (
            <div>
              <label className="block text-sm font-medium text-foreground-muted mb-2">Bot URL</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-background border border-border">
                <code className="flex-1 font-mono text-sm text-foreground break-all">{instance.public_url}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(instance.public_url || "")}
                  className="p-2 rounded-lg hover:bg-background-secondary transition-colors"
                  title="Copy"
                >
                  <CopyIcon className="w-4 h-4 text-foreground-muted" />
                </button>
              </div>
            </div>
          )}

          {/* Control UI Button */}
          {instance.status === "running" && (
            <div>
              <label className="block text-sm font-medium text-foreground-muted mb-2">Control Panel</label>
              <button
                onClick={openControlUI}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
              >
                <ExternalLinkIcon className="w-4 h-4" />
                Open Control UI
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-background-secondary rounded-2xl border border-error/30 overflow-hidden">
        <div className="p-6 border-b border-error/30 bg-error-light/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error/20 flex items-center justify-center">
              <AlertIcon className="w-5 h-5 text-error" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-error-dark">Danger Zone</h2>
              <p className="text-sm text-foreground-muted">Irreversible actions</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Delete Bot</p>
              <p className="text-sm text-foreground-muted">Permanently delete this bot and all its data</p>
            </div>
            <button
              onClick={deleteInstance}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-error text-white font-medium hover:bg-error-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <TrashIcon className="w-4 h-4" />
                  Delete Bot
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; dot: string }> = {
    pending: { bg: "bg-background-tertiary", text: "text-foreground-muted", dot: "bg-foreground-subtle" },
    provisioning: { bg: "bg-warning-light", text: "text-warning-dark", dot: "bg-warning animate-pulse" },
    running: { bg: "bg-success-light", text: "text-success-dark", dot: "bg-success" },
    stopped: { bg: "bg-background-tertiary", text: "text-foreground-muted", dot: "bg-foreground-subtle" },
    error: { bg: "bg-error-light", text: "text-error-dark", dot: "bg-error" },
  };

  const { bg, text, dot } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// Icons
function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.628.105a9.01 9.01 0 01-3.014 0l-.628-.105c-1.717-.293-2.3-2.379-1.067-3.611L16 15.3M5 14.5l-1.402 1.402c-1.232 1.232-.65 3.318 1.067 3.611l.628.105a9.01 9.01 0 003.014 0l.628-.105c1.717-.293 2.3-2.379 1.067-3.611L8 15.3" />
    </svg>
  );
}

function BugIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152 6.06M12 12.75c-2.883 0-5.647.508-8.208 1.44.125 2.104.52 4.136 1.153 6.06M12 12.75a2.25 2.25 0 002.248-2.354M12 12.75a2.25 2.25 0 01-2.248-2.354M12 8.25c.995 0 1.971-.08 2.922-.236.403-.066.74-.358.795-.762a3.778 3.778 0 00-.399-2.25M12 8.25c-.995 0-1.97-.08-2.922-.236-.402-.066-.74-.358-.795-.762a3.734 3.734 0 01.4-2.253M12 8.25a2.25 2.25 0 00-2.248 2.146M12 8.25a2.25 2.25 0 012.248 2.146M8.683 5a6.032 6.032 0 01-1.155-1.002c.07-.63.27-1.222.574-1.747m.581 2.749A3.75 3.75 0 0115.318 5m0 0c.427-.283.815-.62 1.155-.999a4.471 4.471 0 00-.575-1.752M4.921 6a24.048 24.048 0 00-.392 3.314c1.668.546 3.416.914 5.223 1.082M19.08 6c.205 1.08.337 2.187.392 3.314a23.882 23.882 0 01-5.223 1.082" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}
