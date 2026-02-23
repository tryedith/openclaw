"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

interface UserDetail {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  subscription_tier: string;
  subscription_expires_at: string | null;
  created_at: string;
}

interface Instance {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface Usage {
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [usage, setUsage] = useState<Usage>({ totalCostUsd: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 });
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    fetch(`/api/admin/users/${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setUser(data.user);
        setInstances(data.instances ?? []);
        setUsage(data.usage ?? {});
        setTier(data.user?.subscription_tier ?? "free");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  async function handleSaveTier() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_tier: tier }),
      });
      if (res.ok) {
        setSaveMsg("Saved");
      } else {
        const data = await res.json();
        setSaveMsg(data.error || "Failed");
      }
    } catch {
      setSaveMsg("Error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-foreground-muted">Loading...</div>;
  }

  if (!user) {
    return <div className="text-foreground-muted">User not found</div>;
  }

  return (
    <div className="space-y-8">
      <Link href="/admin/users" className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Users
      </Link>

      {/* Profile card */}
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-full" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold">
                {user.email[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-foreground">{user.display_name || user.email}</h1>
              <p className="text-sm text-foreground-muted">{user.email}</p>
              <p className="text-xs text-foreground-subtle mt-1">
                Joined {new Date(user.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Tier editor */}
        <div className="mt-6 flex items-center gap-4">
          <label className="text-sm text-foreground-muted">Subscription Tier:</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <button
            onClick={handleSaveTier}
            disabled={saving || tier === user.subscription_tier}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
          {saveMsg && <span className="text-xs text-foreground-muted">{saveMsg}</span>}
        </div>
      </div>

      {/* Usage summary */}
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Usage (This Month)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-foreground-muted">Cost</p>
            <p className="text-lg font-bold text-foreground">${usage.totalCostUsd.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Requests</p>
            <p className="text-lg font-bold text-foreground">{usage.totalRequests.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Input Tokens</p>
            <p className="text-lg font-bold text-foreground">{usage.totalInputTokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Output Tokens</p>
            <p className="text-lg font-bold text-foreground">{usage.totalOutputTokens.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Instances */}
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Instances ({instances.length})
        </h2>
        {instances.length === 0 ? (
          <p className="text-sm text-foreground-muted">No instances</p>
        ) : (
          <div className="space-y-2">
            {instances.map((inst) => (
              <Link
                key={inst.id}
                href={`/admin/instances/${inst.id}`}
                className="flex items-center justify-between py-3 px-4 rounded-xl hover:bg-background transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[inst.status] || "bg-foreground-subtle"}`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{inst.name}</p>
                  </div>
                </div>
                <span className="text-xs text-foreground-subtle capitalize">{inst.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
