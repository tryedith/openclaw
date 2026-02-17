"use client";

import { use, useEffect, useMemo, useState } from "react";

type UsagePeriod = "day" | "week" | "month" | "all";

interface ModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  promptTokens: number;
  totalTokens: number;
  costUsd: number;
}

interface UsageSummary {
  period: UsagePeriod;
  startDate: string;
  endDate: string;
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalPromptTokens: number;
  totalTokens: number;
  byModel: Record<string, ModelUsage>;
}

const PERIOD_OPTIONS: Array<{ value: UsagePeriod; label: string }> = [
  { value: "day", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

const integerFormatter = new Intl.NumberFormat("en-US");

function formatUsd(value: number): string {
  const fractionDigits = value >= 1 ? 2 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatInteger(value: number): string {
  return integerFormatter.format(Math.max(0, Math.trunc(value)));
}

export default function InstanceUsagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: instanceId } = use(params);

  const [period, setPeriod] = useState<UsagePeriod>("month");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchSummary(period);
  }, [period, instanceId]);

  async function fetchSummary(currentPeriod: UsagePeriod): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/usage/summary?period=${currentPeriod}&instance_id=${instanceId}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch usage");
      }

      setSummary(data as UsageSummary);
    } catch (err) {
      console.error("Failed to load usage summary:", err);
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }

  const modelRows = useMemo(() => {
    return Object.entries(summary?.byModel || {})
      .map(([modelId, usage]) => ({
        modelId,
        ...usage,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }, [summary]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Usage</h1>
        <p className="mt-1 text-foreground-muted">
          Token consumption and spend for this instance.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((option) => {
          const isActive = option.value === period;
          return (
            <button
              key={option.value}
              onClick={() => setPeriod(option.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                isActive
                  ? "bg-primary text-white border-primary"
                  : "bg-background-secondary text-foreground-muted border-border hover:text-foreground hover:border-border-hover"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="bg-error-light border border-error/30 rounded-2xl p-5">
          <p className="text-error-dark font-medium">{error}</p>
          <button
            onClick={() => void fetchSummary(period)}
            className="mt-3 px-4 py-2 rounded-xl bg-error text-white text-sm font-medium hover:bg-error-dark transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading && !summary ? (
        <div className="flex items-center justify-center h-56">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
            <p className="text-foreground-muted">Loading usage...</p>
          </div>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Total Spend"
              value={formatUsd(summary.totalCostUsd)}
              hint="Calculated from stored per-event prices"
            />
            <MetricCard
              label="Requests"
              value={formatInteger(summary.totalRequests)}
              hint="Assistant responses with usage reported"
            />
            <MetricCard
              label="Input Tokens"
              value={formatInteger(summary.totalInputTokens)}
              hint="Non-cache input tokens"
            />
            <MetricCard
              label="Output Tokens"
              value={formatInteger(summary.totalOutputTokens)}
              hint="Generated completion tokens"
            />
          </div>

          <div className="bg-background-secondary rounded-2xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                Token Breakdown
              </h2>
              <p className="text-sm text-foreground-muted">
                Prompt = Input + Cache Read + Cache Write
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background">
                  <tr className="text-left text-foreground-subtle">
                    <th className="px-6 py-3 font-medium">Input</th>
                    <th className="px-6 py-3 font-medium">Cache Read</th>
                    <th className="px-6 py-3 font-medium">Cache Write</th>
                    <th className="px-6 py-3 font-medium">Prompt</th>
                    <th className="px-6 py-3 font-medium">Output</th>
                    <th className="px-6 py-3 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-6 py-4 text-foreground-muted">
                      {formatInteger(summary.totalInputTokens)}
                    </td>
                    <td className="px-6 py-4 text-foreground-muted">
                      {formatInteger(summary.totalCacheReadTokens)}
                    </td>
                    <td className="px-6 py-4 text-foreground-muted">
                      {formatInteger(summary.totalCacheWriteTokens)}
                    </td>
                    <td className="px-6 py-4 text-foreground-muted">
                      {formatInteger(summary.totalPromptTokens)}
                    </td>
                    <td className="px-6 py-4 text-foreground-muted">
                      {formatInteger(summary.totalOutputTokens)}
                    </td>
                    <td className="px-6 py-4 font-medium text-foreground">
                      {formatInteger(summary.totalTokens)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-background-secondary rounded-2xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-foreground">By Model</h2>
                <p className="text-sm text-foreground-muted">
                  {new Date(summary.startDate).toLocaleString()} - {new Date(summary.endDate).toLocaleString()}
                </p>
              </div>
              {loading ? (
                <div className="text-xs text-foreground-subtle">Refreshing...</div>
              ) : null}
            </div>

            {modelRows.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-foreground-muted">No usage recorded for this period yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-background">
                    <tr className="text-left text-foreground-subtle">
                      <th className="px-6 py-3 font-medium">Model</th>
                      <th className="px-6 py-3 font-medium">Requests</th>
                      <th className="px-6 py-3 font-medium">Input</th>
                      <th className="px-6 py-3 font-medium">Cache Read</th>
                      <th className="px-6 py-3 font-medium">Cache Write</th>
                      <th className="px-6 py-3 font-medium">Prompt</th>
                      <th className="px-6 py-3 font-medium">Output</th>
                      <th className="px-6 py-3 font-medium">Total</th>
                      <th className="px-6 py-3 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((row) => (
                      <tr key={row.modelId} className="border-t border-border">
                        <td className="px-6 py-4 font-medium text-foreground">{row.modelId}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.requests)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.inputTokens)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.cacheReadTokens)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.cacheWriteTokens)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.promptTokens)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.outputTokens)}</td>
                        <td className="px-6 py-4 text-foreground-muted">{formatInteger(row.totalTokens)}</td>
                        <td className="px-6 py-4 text-right font-medium text-foreground">
                          {formatUsd(row.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-5">
      <p className="text-sm text-foreground-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-2 text-xs text-foreground-subtle">{hint}</p>
    </div>
  );
}
