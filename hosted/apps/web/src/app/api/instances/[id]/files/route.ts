import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";
import type { FileNode } from "@/app/dashboard/types";

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAtMs?: number;
}

interface WorkspaceTreeResult {
  agentId: string;
  workspace: string;
  entries: TreeEntry[];
}

function buildTree(entries: TreeEntry[]): FileNode[] {
  const root: FileNode[] = [];
  const dirMap = new Map<string, FileNode>();

  for (const entry of entries) {
    const node: FileNode = {
      name: entry.name,
      type: entry.type,
      path: entry.path,
      size: entry.size,
      updatedAt: entry.updatedAtMs,
      ...(entry.type === "directory" ? { children: [] } : {}),
    };

    // Find parent directory path
    const lastSlash = entry.path.lastIndexOf("/");
    const parentPath = lastSlash > 0 ? entry.path.substring(0, lastSlash) : "";

    if (entry.type === "directory") {
      dirMap.set(entry.path, node);
    }

    if (parentPath && dirMap.has(parentPath)) {
      dirMap.get(parentPath)!.children!.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

// GET /api/instances/[id]/files - List workspace files
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url) {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  let gatewayUrl: string;
  let token: string;
  try {
    const resolved = resolveGatewayTarget({
      instancePublicUrl: instance.public_url,
      instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
      instanceId: id,
    });
    gatewayUrl = resolved.gatewayUrl;
    token = resolved.token;
  } catch (err) {
    console.error("[files] Failed to resolve gateway target:", err);
    return NextResponse.json(
      { error: "Failed to resolve gateway credentials" },
      { status: 500 }
    );
  }

  try {
    const result = await gatewayRpc<WorkspaceTreeResult>({
      gatewayUrl,
      token,
      method: "workspace.tree",
      rpcParams: { agentId: "main" },
    });

    if (!result.ok) {
      console.error("[files] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to list files", details: result.error },
        { status: 500 }
      );
    }

    const tree = buildTree(result.payload?.entries ?? []);
    return NextResponse.json({ tree });
  } catch (err) {
    console.error("[files] Error:", err);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(err) },
      { status: 500 }
    );
  }
}
