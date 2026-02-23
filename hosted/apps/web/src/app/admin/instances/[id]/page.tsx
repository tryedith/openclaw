"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Square, FileText, ChevronDown, ChevronUp } from "lucide-react";

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

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

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
