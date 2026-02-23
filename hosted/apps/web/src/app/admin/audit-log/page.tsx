"use client";

import { useEffect, useState, useCallback } from "react";

interface AuditEntry {
  id: string;
  admin_user_id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const limit = 30;

  const fetchLog = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });

    fetch(`/api/admin/audit-log?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>

      <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Time</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Admin</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Action</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Target</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">No audit entries yet</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground-muted whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-foreground">{e.admin_email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {e.target_type && e.target_id ? (
                      <span className="font-mono text-xs">{e.target_type}/{e.target_id.slice(0, 8)}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted max-w-xs truncate">
                    {Object.keys(e.details).length > 0 ? (
                      <span className="font-mono text-xs">{JSON.stringify(e.details)}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">{total} entries total</span>
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
