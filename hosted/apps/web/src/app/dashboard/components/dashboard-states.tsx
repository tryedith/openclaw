import { AlertIcon, RocketIcon, SparklesIcon, TrashIcon } from "../icons";

export function DashboardLoadingState() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
        <p className="text-foreground-muted">Loading your dashboard...</p>
      </div>
    </div>
  );
}

export function DashboardCreateState({
  creating,
  onCreate,
}: {
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-primary-light flex items-center justify-center mb-6">
          <RocketIcon className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Create your AI assistant</h1>
        <p className="text-foreground-muted mb-8">
          Get started by creating your personal bot instance. It only takes a minute.
        </p>
        <button
          onClick={onCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-white font-semibold text-lg hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/25"
        >
          {creating ? (
            <>
              <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <SparklesIcon className="w-5 h-5" />
              Create Bot
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function DashboardProvisioningState({
  deleting,
  onDelete,
}: {
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-light flex items-center justify-center mb-6">
          <div className="w-8 h-8 rounded-full border-3 border-primary border-t-transparent animate-spin" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Setting up your assistant</h1>
        <p className="text-foreground-muted mb-8">
          This usually takes 2-3 minutes. You can wait here or come back later.
        </p>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-foreground-muted hover:text-error hover:bg-error-light transition-colors text-sm"
        >
          <TrashIcon className="w-4 h-4" />
          {deleting ? "Cancelling..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}

export function DashboardErrorState({
  deleting,
  onDelete,
}: {
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-full bg-error-light flex items-center justify-center mb-6">
          <AlertIcon className="w-8 h-8 text-error" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Something went wrong</h1>
        <p className="text-foreground-muted mb-8">
          Your bot failed to start. Please delete and try again.
        </p>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-error text-white font-semibold hover:bg-error-dark active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {deleting ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <TrashIcon className="w-4 h-4" />
              Delete & Retry
            </>
          )}
        </button>
      </div>
    </div>
  );
}
