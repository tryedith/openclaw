"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  subscription_tier: string;
  instance_count: number;
  monthly_cost_usd: number;
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const limit = 20;

  const fetchUsers = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) {params.set("search", search);}

    fetch(`/api/admin/users?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setUsers(data.users ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Users</h1>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-background-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Email</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Name</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Tier</th>
              <th className="text-right px-4 py-3 font-medium text-foreground-muted">Instances</th>
              <th className="text-right px-4 py-3 font-medium text-foreground-muted">Monthly Cost</th>
              <th className="text-left px-4 py-3 font-medium text-foreground-muted">Signed Up</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">No users found</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-background transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className="text-primary hover:underline">{u.email}</Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">{u.display_name || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.subscription_tier === "enterprise" ? "bg-primary/10 text-primary" :
                      u.subscription_tier === "pro" ? "bg-success/10 text-success" :
                      "bg-foreground-subtle/10 text-foreground-muted"
                    }`}>
                      {u.subscription_tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{u.instance_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">${u.monthly_cost_usd.toFixed(4)}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">{total} users total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-xl text-sm border border-border bg-background text-foreground disabled:opacity-50 hover:bg-background-secondary transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-foreground-muted">
              Page {page} of {totalPages}
            </span>
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
