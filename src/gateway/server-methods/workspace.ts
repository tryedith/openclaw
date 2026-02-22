import fs from "node:fs/promises";
import path from "node:path";
import { listAgentIds, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkspaceTreeParams,
  validateWorkspaceReadParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const BLOCKED_DIRS = new Set([
  ".secrets",
  ".git",
  "node_modules",
  ".venv",
  "__pycache__",
  ".openclaw",
]);
const MAX_READ_SIZE = 5_242_880; // 5 MB
const MAX_DEPTH = 8;

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAtMs?: number;
}

function resolveAgentIdOrError(
  agentIdRaw: string,
  cfg: ReturnType<typeof loadConfig>,
): string | null {
  const agentId = normalizeAgentId(agentIdRaw);
  const allowed = new Set(listAgentIds(cfg));
  return allowed.has(agentId) ? agentId : null;
}

function isPathSafe(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/")) {
    return false;
  }
  const segments = relPath.split(/[/\\]/);
  if (segments.some((s) => s === "..")) {
    return false;
  }
  if (BLOCKED_DIRS.has(segments[0])) {
    return false;
  }
  return true;
}

async function walkDir(
  baseDir: string,
  relDir: string,
  entries: TreeEntry[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    return;
  }

  let dirents;
  try {
    dirents = await fs.readdir(path.join(baseDir, relDir), { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then files, alphabetical
  dirents.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) {
      return aDir - bDir;
    }
    return a.name.localeCompare(b.name);
  });

  for (const dirent of dirents) {
    if (BLOCKED_DIRS.has(dirent.name)) {
      continue;
    }
    // Skip hidden files/dirs (starting with .) except the root level
    if (dirent.name.startsWith(".") && BLOCKED_DIRS.has(dirent.name)) {
      continue;
    }

    const entryRelPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;

    if (dirent.isDirectory()) {
      entries.push({ name: dirent.name, path: entryRelPath, type: "directory" });
      await walkDir(baseDir, entryRelPath, entries, depth + 1);
    } else if (dirent.isFile()) {
      let size: number | undefined;
      let updatedAtMs: number | undefined;
      try {
        const stat = await fs.stat(path.join(baseDir, entryRelPath));
        size = stat.size;
        updatedAtMs = Math.floor(stat.mtimeMs);
      } catch {
        // best-effort
      }
      entries.push({ name: dirent.name, path: entryRelPath, type: "file", size, updatedAtMs });
    }
  }
}

export const workspaceHandlers: GatewayRequestHandlers = {
  "workspace.tree": async ({ params, respond }) => {
    if (!validateWorkspaceTreeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.tree params: ${formatValidationErrors(validateWorkspaceTreeParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }

    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

    // Optional sub-path filtering
    const subPath = typeof params.path === "string" ? params.path.trim() : "";
    if (subPath && !isPathSafe(subPath)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid path"));
      return;
    }

    const entries: TreeEntry[] = [];
    await walkDir(workspaceDir, subPath, entries, 0);

    respond(true, { agentId, workspace: workspaceDir, entries }, undefined);
  },

  "workspace.read": async ({ params, respond }) => {
    if (!validateWorkspaceReadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.read params: ${formatValidationErrors(validateWorkspaceReadParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }

    const filePath = String(params.path ?? "").trim();
    if (!isPathSafe(filePath)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid path"));
      return;
    }

    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const fullPath = path.join(workspaceDir, filePath);

    // Ensure resolved path is still inside workspace
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(workspaceDir))) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path outside workspace"));
      return;
    }

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found"));
      return;
    }

    if (!stat.isFile()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not a file"));
      return;
    }

    if (stat.size > MAX_READ_SIZE) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `file too large (${stat.size} bytes, max ${MAX_READ_SIZE})`,
        ),
      );
      return;
    }

    const content = await fs.readFile(fullPath, "utf-8");
    const name = path.basename(filePath);

    respond(
      true,
      {
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          size: stat.size,
          updatedAtMs: Math.floor(stat.mtimeMs),
          content,
        },
      },
      undefined,
    );
  },
};
