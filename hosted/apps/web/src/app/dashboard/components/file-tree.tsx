"use client";

import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  File,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { FileNode } from "../types";

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  expandedDirs: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  depth?: number;
}

function getFileIcon(name: string) {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".md":
      return FileText;
    case ".py":
    case ".ts":
    case ".js":
    case ".sh":
    case ".json":
    case ".yaml":
    case ".yml":
    case ".toml":
      return FileCode;
    default:
      return File;
  }
}

export function FileTree({
  nodes,
  selectedPath,
  expandedDirs,
  onSelectFile,
  onToggleDir,
  depth = 0,
}: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        if (node.type === "directory") {
          const isExpanded = expandedDirs.has(node.path);
          const DirIcon = isExpanded ? FolderOpen : Folder;
          const Arrow = isExpanded ? ChevronDown : ChevronRight;
          return (
            <div key={node.path}>
              <button
                onClick={() => onToggleDir(node.path)}
                className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-sm text-foreground hover:bg-background-secondary transition-colors"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                <Arrow className="w-3.5 h-3.5 text-foreground-subtle flex-shrink-0" />
                <DirIcon className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="truncate font-medium">{node.name}</span>
              </button>
              {isExpanded && node.children && (
                <FileTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  expandedDirs={expandedDirs}
                  onSelectFile={onSelectFile}
                  onToggleDir={onToggleDir}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const FileIcon = getFileIcon(node.name);
        const isSelected = selectedPath === node.path;

        return (
          <button
            key={node.path}
            onClick={() => onSelectFile(node.path)}
            className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-sm transition-colors ${
              isSelected
                ? "bg-primary-light text-primary font-medium"
                : "text-foreground hover:bg-background-secondary"
            }`}
            style={{ paddingLeft: `${depth * 16 + 24}px` }}
          >
            <FileIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
