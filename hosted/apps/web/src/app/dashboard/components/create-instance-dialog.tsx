"use client";

import { useState } from "react";
import { SparklesIcon } from "../icons";

export function CreateInstanceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Failed to create instance");
        return;
      }

      onCreated();
    } catch (err) {
      setError("Failed to create instance");
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-background rounded-2xl border border-border shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-foreground mb-4">
          Create New Instance
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer Support Bot"
              maxLength={50}
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-background-secondary border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) void handleCreate();
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Description{" "}
              <span className="text-foreground-subtle font-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will this bot do?"
              maxLength={200}
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl bg-background-secondary border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-error">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <SparklesIcon className="w-4 h-4" />
                Create
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
