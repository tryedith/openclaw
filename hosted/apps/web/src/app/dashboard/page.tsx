"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RocketIcon, SparklesIcon, TrashIcon } from "./icons";
import { CreateInstanceDialog } from "./components/create-instance-dialog";
import type { Instance } from "./types";

export default function DashboardPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchInstances() {
    try {
      const response = await fetch("/api/instances");
      const data = await response.json();
      setInstances((data.instances as Instance[]) || []);
    } catch (error) {
      console.error("Error fetching instances:", error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteInstance(id: string) {
    if (!confirm("Are you sure you want to delete this bot instance?")) return;

    setDeletingId(id);
    try {
      const response = await fetch(`/api/instances/${id}`, { method: "DELETE" });
      if (response.ok) {
        setInstances((prev) => prev.filter((inst) => inst.id !== id));
      }
    } catch (error) {
      console.error("Error deleting instance:", error);
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void fetchInstances();
  }, []);

  // Poll for provisioning instances
  useEffect(() => {
    const hasProvisioning = instances.some(
      (inst) => inst.status === "provisioning" || inst.status === "pending"
    );
    if (!hasProvisioning) return;

    const interval = setInterval(() => {
      void fetchInstances();
    }, 3000);
    return () => clearInterval(interval);
  }, [instances]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
          <p className="text-foreground-muted">Loading your instances...</p>
        </div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-primary-light flex items-center justify-center mb-6">
            <RocketIcon className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Create your first bot
          </h1>
          <p className="text-foreground-muted mb-8">
            Deploy a named bot instance to get started. You can create multiple
            bots with different configurations.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-white font-semibold text-lg hover:bg-primary-hover active:scale-[0.98] transition-all shadow-lg shadow-primary/25"
          >
            <SparklesIcon className="w-5 h-5" />
            Create Bot
          </button>
          {showCreate && (
            <CreateInstanceDialog
              onClose={() => setShowCreate(false)}
              onCreated={() => {
                setShowCreate(false);
                void fetchInstances();
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Instances</h1>
          <p className="mt-1 text-foreground-muted">
            Manage your bot instances
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
        >
          <SparklesIcon className="w-4 h-4" />
          New Instance
        </button>
      </div>

      <div className="grid gap-4">
        {instances.map((inst) => (
          <InstanceCard
            key={inst.id}
            instance={inst}
            deleting={deletingId === inst.id}
            onDelete={() => deleteInstance(inst.id)}
          />
        ))}
      </div>

      {showCreate && (
        <CreateInstanceDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void fetchInstances();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Instance["status"] }) {
  const config: Record<
    Instance["status"],
    { color: string; bg: string; label: string; pulse?: boolean }
  > = {
    running: { color: "bg-success", bg: "bg-success-light text-success-dark", label: "Running" },
    provisioning: {
      color: "bg-warning",
      bg: "bg-warning-light text-warning-dark",
      label: "Provisioning",
      pulse: true,
    },
    pending: {
      color: "bg-warning",
      bg: "bg-warning-light text-warning-dark",
      label: "Pending",
      pulse: true,
    },
    stopped: { color: "bg-foreground-subtle", bg: "bg-background text-foreground-muted", label: "Stopped" },
    error: { color: "bg-error", bg: "bg-error-light text-error-dark", label: "Error" },
  };

  const c = config[status] || config.stopped;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.color} ${c.pulse ? "animate-pulse" : ""}`} />
      {c.label}
    </span>
  );
}

function InstanceCard({
  instance,
  deleting,
  onDelete,
}: {
  instance: Instance;
  deleting: boolean;
  onDelete: () => void;
}) {
  const channelCount = instance.channels?.length ?? 0;
  const createdAt = instance.created_at
    ? new Date(instance.created_at).toLocaleDateString()
    : null;

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between">
        <Link
          href={`/dashboard/instances/${instance.id}`}
          className="flex-1 min-w-0"
        >
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {instance.name}
            </h3>
            <StatusBadge status={instance.status} />
          </div>
          {instance.description && (
            <p className="text-sm text-foreground-muted mb-3 line-clamp-2">
              {instance.description}
            </p>
          )}
          <div className="flex items-center gap-4 text-xs text-foreground-subtle">
            {createdAt && <span>Created {createdAt}</span>}
            {channelCount > 0 && (
              <span>
                {channelCount} channel{channelCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </Link>

        <button
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
          disabled={deleting}
          className="ml-4 p-2 rounded-lg text-foreground-subtle hover:text-error hover:bg-error-light transition-colors disabled:opacity-50"
          title="Delete instance"
        >
          {deleting ? (
            <div className="w-4 h-4 rounded-full border-2 border-error/30 border-t-error animate-spin" />
          ) : (
            <TrashIcon className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
