"use client";

import { use } from "react";
import Link from "next/link";
import { ChatIcon } from "../../icons";
import { ChatPanel } from "../../components/chat-panel";
import { ModelControls } from "../../components/model-controls";
import {
  DashboardLoadingState,
  DashboardProvisioningState,
  DashboardErrorState,
} from "../../components/dashboard-states";
import { useDashboardChat } from "../../use-dashboard-chat";

export default function InstanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const {
    instance,
    loading,
    message,
    setMessage,
    chatHistory,
    sending,
    streamingAssistant,
    activeRunId,
    startingNewChat,
    liveConnected,
    liveError,
    historyLoading,
    modelsLoading,
    modelsError,
    modelSaving,
    modelMessage,
    providerGroups,
    currentModelRef,
    selectedProvider,
    setSelectedProvider,
    selectedModelRef,
    setSelectedModelRef,
    selectedProviderModels,
    canSaveModel,
    sendMessage,
    startNewChat,
    saveSelectedModel,
  } = useDashboardChat(id);

  if (loading) {
    return <DashboardLoadingState />;
  }

  if (!instance) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-2">Instance not found</h1>
          <p className="text-foreground-muted mb-6">
            This instance may have been deleted.
          </p>
          <Link
            href="/dashboard"
            className="text-primary hover:underline font-medium"
          >
            Back to instances
          </Link>
        </div>
      </div>
    );
  }

  if (instance.status === "provisioning" || instance.status === "pending") {
    return (
      <div>
        <BackLink />
        <DashboardProvisioningState deleting={false} onDelete={() => {}} />
      </div>
    );
  }

  if (instance.status === "error") {
    return (
      <div>
        <BackLink />
        <DashboardErrorState deleting={false} onDelete={() => {}} />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <ChatIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard"
                className="text-foreground-muted hover:text-foreground text-sm"
              >
                Instances
              </Link>
              <span className="text-foreground-subtle text-sm">/</span>
              <h1 className="text-xl font-semibold text-foreground">
                {instance.name}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  liveConnected ? "bg-success" : "bg-warning animate-pulse"
                }`}
              />
              <span className="text-sm text-foreground-muted">
                {liveConnected ? "Live gateway connected" : "Reconnecting to gateway"}
              </span>
              {activeRunId ? (
                <span className="text-xs text-foreground-subtle">Run {activeRunId.slice(0, 8)}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {liveError ? <p className="text-xs text-error max-w-xs text-right">{liveError}</p> : null}
          <button
            type="button"
            onClick={startNewChat}
            disabled={startingNewChat || sending}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-background-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startingNewChat ? "Starting..." : "New Chat"}
          </button>
        </div>
      </div>

      <ModelControls
        modelsLoading={modelsLoading}
        modelSaving={modelSaving}
        providerGroups={providerGroups}
        selectedProvider={selectedProvider}
        onProviderChange={setSelectedProvider}
        selectedModelRef={selectedModelRef}
        onModelChange={setSelectedModelRef}
        selectedProviderModels={selectedProviderModels}
        onApply={saveSelectedModel}
        canSaveModel={canSaveModel}
        currentModelRef={currentModelRef}
        modelsError={modelsError}
        modelMessage={modelMessage}
      />

      <div className="flex-1 bg-background-secondary rounded-2xl border border-border overflow-hidden flex flex-col">
        <ChatPanel
          historyLoading={historyLoading}
          chatHistory={chatHistory}
          sending={sending}
          streamingAssistant={streamingAssistant}
          message={message}
          onMessageChange={setMessage}
          onSend={sendMessage}
        />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <div className="mb-4">
      <Link
        href="/dashboard"
        className="text-sm text-foreground-muted hover:text-foreground"
      >
        &larr; Back to instances
      </Link>
    </div>
  );
}
