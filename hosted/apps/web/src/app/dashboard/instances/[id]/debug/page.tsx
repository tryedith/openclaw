"use client";

import { use, useEffect, useState } from "react";
import {
  Bot,
  Bug,
  ClipboardCopy,
  ExternalLink,
  TriangleAlert,
  Trash2,
} from "lucide-react";

interface Instance {
  id: string;
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  public_url: string | null;
}

export default function InstanceDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: instanceId } = use(params);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchInstance();
  }, [instanceId]);

  async function fetchInstance() {
    try {
      const response = await fetch("/api/instances");
      const data = await response.json();
      if (data.instances) {
        const inst = (data.instances as Instance[]).find((i) => i.id === instanceId);
        if (inst) {
          setInstance(inst);
        }
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
            <Bug className="w-8 h-8 text-foreground-subtle" />
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
              <Bot className="w-5 h-5 text-primary" />
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
                <ClipboardCopy className="w-4 h-4 text-foreground-muted" />
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
                  <ClipboardCopy className="w-4 h-4 text-foreground-muted" />
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
                <ExternalLink className="w-4 h-4" />
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
              <TriangleAlert className="w-5 h-5 text-error" />
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
                  <Trash2 className="w-4 h-4" />
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
