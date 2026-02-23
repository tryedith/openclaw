"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

interface PoolInstance {
  instanceId: string;
  status: "initializing" | "available" | "assigned";
  privateIp?: string;
  publicIp?: string;
  userId?: string;
}

interface PoolStats {
  total: number;
  available: number;
  assigned: number;
  initializing: number;
}

const POOL_STATUS_DOT: Record<string, string> = {
  available: "bg-success",
  assigned: "bg-primary",
  initializing: "bg-warning animate-pulse",
};

export default function AdminInfraPage() {
  const [stats, setStats] = useState<PoolStats>({ total: 0, available: 0, assigned: 0, initializing: 0 });
  const [instances, setInstances] = useState<PoolInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [replenishing, setReplenishing] = useState(false);
  const [msg, setMsg] = useState("");

  function fetchPool() {
    setLoading(true);
    fetch("/api/admin/infra/pool")
      .then((r) => r.json())
      .then((data) => {
        setStats(data.stats ?? { total: 0, available: 0, assigned: 0, initializing: 0 });
        setInstances(data.instances ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchPool();
  }, []);

  async function handleReplenish() {
    setReplenishing(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/infra/pool", { method: "POST" });
      if (res.ok) {
        setMsg("Pool replenish triggered");
        // Refresh after a short delay
        setTimeout(fetchPool, 3000);
      } else {
        const data = await res.json();
        setMsg(data.error || "Failed");
      }
    } catch {
      setMsg("Error");
    } finally {
      setReplenishing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Infrastructure</h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-foreground-muted">{msg}</span>}
          <button
            onClick={handleReplenish}
            disabled={replenishing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${replenishing ? "animate-spin" : ""}`} />
            Replenish Pool
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-foreground-muted">Loading...</div>
      ) : (
        <>
          {/* Pool stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Available</p>
              <p className="text-2xl font-bold text-success">{stats.available}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Assigned</p>
              <p className="text-2xl font-bold text-primary">{stats.assigned}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Initializing</p>
              <p className="text-2xl font-bold text-warning">{stats.initializing}</p>
            </div>
          </div>

          {/* Pool instances table */}
          <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-foreground-muted">Instance ID</th>
                  <th className="text-left px-4 py-3 font-medium text-foreground-muted">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-foreground-muted">Private IP</th>
                  <th className="text-left px-4 py-3 font-medium text-foreground-muted">Public IP</th>
                  <th className="text-left px-4 py-3 font-medium text-foreground-muted">User ID</th>
                </tr>
              </thead>
              <tbody>
                {instances.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">No instances in pool</td></tr>
                ) : (
                  instances.map((inst) => (
                    <tr key={inst.instanceId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{inst.instanceId}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${POOL_STATUS_DOT[inst.status] || "bg-foreground-subtle"}`} />
                          <span className="text-foreground capitalize">{inst.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{inst.privateIp || "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{inst.publicIp || "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{inst.userId || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
