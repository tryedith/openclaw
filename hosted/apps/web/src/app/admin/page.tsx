"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Server, DollarSign, Cloud } from "lucide-react";

interface Stats {
  totalUsers: number;
  runningInstances: number;
  monthlyCost: number;
  poolAvailable: number;
}

interface RecentUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface RecentInstance {
  id: string;
  name: string;
  status: string;
  user_email: string;
  created_at: string;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, runningInstances: 0, monthlyCost: 0, poolAvailable: 0 });
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentInstances, setRecentInstances] = useState<RecentInstance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users?limit=10").then((r) => r.json()),
      fetch("/api/admin/instances?limit=10").then((r) => r.json()),
      fetch("/api/admin/usage/summary?period=month").then((r) => r.json()),
      fetch("/api/admin/infra/pool").then((r) => r.json()),
    ])
      .then(([usersData, instancesData, usageData, poolData]) => {
        setStats({
          totalUsers: usersData.total ?? 0,
          runningInstances: (instancesData.instances ?? []).filter((i: RecentInstance) => i.status === "running").length,
          monthlyCost: usageData.totalCostUsd ?? 0,
          poolAvailable: poolData.stats?.available ?? 0,
        });
        setRecentUsers(usersData.users ?? []);
        setRecentInstances(instancesData.instances ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-foreground-muted">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Admin Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} />
        <StatCard icon={Server} label="Running Instances" value={stats.runningInstances} />
        <StatCard icon={DollarSign} label="Monthly Cost" value={`$${stats.monthlyCost.toFixed(2)}`} />
        <StatCard icon={Cloud} label="Pool Available" value={stats.poolAvailable} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Users */}
        <div className="rounded-2xl border border-border bg-background-secondary p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Recent Signups</h2>
            <Link href="/admin/users" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentUsers.slice(0, 5).map((u) => (
              <Link
                key={u.id}
                href={`/admin/users/${u.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-background transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{u.email}</p>
                  <p className="text-xs text-foreground-muted">{u.display_name || "No name"}</p>
                </div>
                <span className="text-xs text-foreground-subtle">
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
            {recentUsers.length === 0 && (
              <p className="text-sm text-foreground-muted">No users yet</p>
            )}
          </div>
        </div>

        {/* Recent Instances */}
        <div className="rounded-2xl border border-border bg-background-secondary p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Recent Instances</h2>
            <Link href="/admin/instances" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentInstances.slice(0, 5).map((inst) => (
              <Link
                key={inst.id}
                href={`/admin/instances/${inst.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-background transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[inst.status] || "bg-foreground-subtle"}`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{inst.name}</p>
                    <p className="text-xs text-foreground-muted">{inst.user_email}</p>
                  </div>
                </div>
                <span className="text-xs text-foreground-subtle">
                  {new Date(inst.created_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
            {recentInstances.length === 0 && (
              <p className="text-sm text-foreground-muted">No instances yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-background-secondary p-6">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-5 h-5 text-foreground-muted" />
        <span className="text-sm text-foreground-muted">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
