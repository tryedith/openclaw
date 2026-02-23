"use client";

import { useEffect, useState } from "react";

interface ByModel {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface TopUser {
  userId: string;
  costUsd: number;
}

interface UsageData {
  period: string;
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  byModel: Record<string, ByModel>;
  topUsers: TopUser[];
}

const PERIODS = ["day", "week", "month", "all"] as const;

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [period, setPeriod] = useState<string>("month");
  const [loading, setLoading] = useState(true);
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/usage/summary?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // Fetch emails for top users
        if (d.topUsers?.length > 0) {
          const ids = new Set(d.topUsers.map((u: TopUser) => u.userId));
          fetch(`/api/admin/users?limit=50`)
            .then((r) => r.json())
            .then((userData) => {
              const emails: Record<string, string> = {};
              for (const u of userData.users ?? []) {
                if (ids.has(u.id)) {emails[u.id] = u.email;}
              }
              setUserEmails(emails);
            })
            .catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Platform Usage</h1>

      {/* Period selector */}
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              period === p
                ? "bg-primary text-white"
                : "border border-border bg-background text-foreground-muted hover:text-foreground hover:bg-background-secondary"
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="text-foreground-muted">Loading...</div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Total Cost</p>
              <p className="text-xl font-bold text-foreground">${data.totalCostUsd.toFixed(4)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Requests</p>
              <p className="text-xl font-bold text-foreground">{data.totalRequests.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Input Tokens</p>
              <p className="text-xl font-bold text-foreground">{data.totalInputTokens.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background-secondary p-4">
              <p className="text-xs text-foreground-muted">Output Tokens</p>
              <p className="text-xl font-bold text-foreground">{data.totalOutputTokens.toLocaleString()}</p>
            </div>
          </div>

          {/* By model */}
          <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">By Model</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 font-medium text-foreground-muted">Model</th>
                  <th className="text-right px-4 py-2 font-medium text-foreground-muted">Requests</th>
                  <th className="text-right px-4 py-2 font-medium text-foreground-muted">Input</th>
                  <th className="text-right px-4 py-2 font-medium text-foreground-muted">Output</th>
                  <th className="text-right px-4 py-2 font-medium text-foreground-muted">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byModel)
                  .toSorted(([, a], [, b]) => b.costUsd - a.costUsd)
                  .map(([model, stats]) => (
                    <tr key={model} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-xs text-foreground">{model}</td>
                      <td className="px-4 py-2 text-right text-foreground">{stats.requests.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-foreground">{stats.inputTokens.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-foreground">{stats.outputTokens.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-foreground">${stats.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                {Object.keys(data.byModel).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-foreground-muted">No usage data</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Top users */}
          {data.topUsers.length > 0 && (
            <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Top Users by Cost</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-medium text-foreground-muted">#</th>
                    <th className="text-left px-4 py-2 font-medium text-foreground-muted">User</th>
                    <th className="text-right px-4 py-2 font-medium text-foreground-muted">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topUsers.map((u, i) => (
                    <tr key={u.userId} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-foreground-muted">{i + 1}</td>
                      <td className="px-4 py-2 text-foreground">{userEmails[u.userId] || u.userId}</td>
                      <td className="px-4 py-2 text-right text-foreground">${u.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
