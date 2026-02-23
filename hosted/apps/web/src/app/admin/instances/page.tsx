"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface InstanceRow {
  id: string;
  name: string;
  status: string;
  user_email: string;
  user_display_name: string | null;
  aws_service_arn: string | null;
  created_at: string;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

const STATUS_FILTERS = ["all", "running", "stopped", "error", "provisioning", "pending"] as const;

export default function AdminInstancesPage() {
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const limit = 20;

  const fetchInstances = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (statusFilter !== "all") {params.set("status", statusFilter);}

    fetch(`/api/admin/instances?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setInstances(data.instances ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Instances</h1>

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              statusFilter === s
                ? "bg-primary text-white"
                : "border border-border bg-background text-foreground-muted hover:text-foreground hover:bg-background-secondary"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Instance</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">User</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Status</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">EC2 ID</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">Loading...</td></tr>
            ) : instances.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">No instances found</td></tr>
            ) : (
              instances.map((inst) => (
                <tr key={inst.id} className="border-b border-border last:border-0 hover:bg-background transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/instances/${inst.id}`} className="text-primary hover:underline">{inst.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">{inst.user_email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[inst.status] || "bg-foreground-subtle"}`} />
                      <span className="text-foreground capitalize">{inst.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted font-mono text-xs">{inst.aws_service_arn || "-"}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(inst.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">{total} instances total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-xl text-sm border border-border bg-background text-foreground disabled:opacity-50 hover:bg-background-secondary transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-foreground-muted">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-xl text-sm border border-border bg-background text-foreground disabled:opacity-50 hover:bg-background-secondary transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
