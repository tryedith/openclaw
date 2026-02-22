"use client";

import { use, useCallback, useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { FileTree } from "@/app/dashboard/components/file-tree";
import { FileViewer } from "@/app/dashboard/components/file-viewer";
import type { FileNode } from "@/app/dashboard/types";

interface FileContent {
  path: string;
  name: string;
  content: string;
  size: number;
  language: string;
}

export default function InstanceFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: instanceId } = use(params);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/instances/${instanceId}/files`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load files");
        return;
      }
      setTree(data.tree ?? []);
    } catch {
      setError("Failed to reach server");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  async function handleSelectFile(path: string) {
    setSelectedPath(path);
    setFileLoading(true);
    try {
      const res = await fetch(
        `/api/instances/${instanceId}/files/content?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setFileContent(null);
        return;
      }
      setFileContent(data);
    } catch {
      setFileContent(null);
    } finally {
      setFileLoading(false);
    }
  }

  function handleToggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
          <p className="text-foreground-muted">Loading files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Files</h1>
          <p className="mt-1 text-foreground-muted">Browse workspace files</p>
        </div>
        <div className="mt-8 bg-background-secondary rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-background flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-foreground-subtle" />
          </div>
          <p className="text-foreground-muted">{error}</p>
          <button
            onClick={fetchTree}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Files</h1>
          <p className="mt-1 text-foreground-muted">Browse workspace files</p>
        </div>
        <button
          onClick={fetchTree}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-background-secondary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 flex bg-background-secondary rounded-2xl border border-border overflow-hidden min-h-0">
        {/* File tree sidebar */}
        <div className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <FolderOpen className="w-8 h-8 text-foreground-subtle mb-2" />
              <p className="text-sm text-foreground-muted">No files found</p>
            </div>
          ) : (
            <FileTree
              nodes={tree}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              onSelectFile={handleSelectFile}
              onToggleDir={handleToggleDir}
            />
          )}
        </div>

        {/* File viewer */}
        <div className="flex-1 min-w-0">
          <FileViewer
            path={fileContent?.path ?? null}
            name={fileContent?.name ?? null}
            content={fileContent?.content ?? null}
            size={fileContent?.size ?? null}
            language={fileContent?.language ?? null}
            loading={fileLoading}
          />
        </div>
      </div>
    </div>
  );
}
