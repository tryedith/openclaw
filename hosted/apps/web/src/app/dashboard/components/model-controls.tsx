import type { ProviderId, ProviderModel, ProviderModelGroup } from "../types";

export function ModelControls({
  modelsLoading,
  modelSaving,
  providerGroups,
  selectedProvider,
  onProviderChange,
  selectedModelRef,
  onModelChange,
  selectedProviderModels,
  onApply,
  canSaveModel,
  currentModelRef,
  modelsError,
  modelMessage,
}: {
  modelsLoading: boolean;
  modelSaving: boolean;
  providerGroups: ProviderModelGroup[];
  selectedProvider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  selectedModelRef: string;
  onModelChange: (modelRef: string) => void;
  selectedProviderModels: ProviderModel[];
  onApply: () => void;
  canSaveModel: boolean;
  currentModelRef: string;
  modelsError: string | null;
  modelMessage: string | null;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Model Provider</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedProvider}
              onChange={(event) => onProviderChange(event.target.value as ProviderId)}
              disabled={modelsLoading || modelSaving || providerGroups.length === 0}
              className="px-3 py-2 rounded-lg bg-background-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {providerGroups.map((group) => (
                <option key={group.provider} value={group.provider}>
                  {group.label}
                </option>
              ))}
            </select>
            <select
              value={selectedModelRef}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={modelsLoading || modelSaving || selectedProviderModels.length === 0}
              className="min-w-[280px] px-3 py-2 rounded-lg bg-background-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {selectedProviderModels.map((model) => (
                <option key={model.modelRef} value={model.modelRef}>
                  {model.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApply}
              disabled={!canSaveModel}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-hover"
            >
              {modelSaving ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
        <div className="text-xs text-foreground-muted">
          <span className="font-medium text-foreground-subtle">Current:</span> {currentModelRef || "Loading..."}
        </div>
      </div>
      {modelsLoading ? (
        <p className="mt-2 text-xs text-foreground-muted">Loading available models...</p>
      ) : null}
      {modelsError ? <p className="mt-2 text-xs text-error">{modelsError}</p> : null}
      {modelMessage ? <p className="mt-2 text-xs text-success">{modelMessage}</p> : null}
    </div>
  );
}
