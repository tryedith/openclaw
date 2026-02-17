"use client";

import Link from "next/link";

export default function ChannelsRedirectPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Channels</h1>
        <p className="mt-1 text-foreground-muted">
          Channels are now managed per instance.
        </p>
      </div>

      <div className="mt-8 bg-background-secondary rounded-2xl border border-border p-12 text-center">
        <p className="text-foreground-muted mb-4">
          Select an instance from the{" "}
          <Link href="/dashboard" className="text-primary hover:underline font-medium">
            Instances
          </Link>{" "}
          page, then navigate to its Channels tab.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
        >
          Go to Instances
        </Link>
      </div>
    </div>
  );
}
