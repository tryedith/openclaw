"use client";

import { useState } from "react";
import { ClipboardCopy, Check, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FileViewerProps {
  path: string | null;
  name: string | null;
  content: string | null;
  size: number | null;
  language: string | null;
  loading: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Breadcrumb({ path }: { path: string }) {
  const parts = ["workspace", ...path.split("/")];
  return (
    <div className="flex items-center gap-1 text-sm text-foreground-muted">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-foreground-subtle">/</span>}
          <span className={i === parts.length - 1 ? "text-foreground font-medium" : ""}>
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

function LineNumbers({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="select-none text-right pr-4 text-foreground-subtle text-xs leading-6">
      {lines.map((_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

export function FileViewer({ path, content, size, language, loading }: FileViewerProps) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);

  const isMarkdown = language === "markdown";

  async function handleCopy() {
    if (!content) {return;}
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-3 border-primary-light border-t-primary animate-spin" />
          <p className="text-sm text-foreground-muted">Loading file...</p>
        </div>
      </div>
    );
  }

  if (!path || !content) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-background-secondary flex items-center justify-center">
            <FileText className="w-6 h-6 text-foreground-subtle" />
          </div>
          <p className="text-foreground-muted">Select a file to view its contents</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-4 min-w-0">
          <Breadcrumb path={path} />
          {size != null && (
            <span className="text-xs text-foreground-subtle flex-shrink-0">{formatSize(size)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setViewMode("preview")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === "preview"
                    ? "bg-primary text-white"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setViewMode("source")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === "source"
                    ? "bg-primary text-white"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Source
              </button>
            </div>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied
              </>
            ) : (
              <>
                <ClipboardCopy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isMarkdown && viewMode === "preview" ? (
          <div className="p-6 prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-code:bg-background-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-background-secondary prose-pre:border prose-pre:border-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex text-xs font-mono">
            <LineNumbers content={content} />
            <pre className="flex-1 p-4 leading-6 overflow-x-auto whitespace-pre text-foreground">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
