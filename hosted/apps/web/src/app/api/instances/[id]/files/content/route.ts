import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

interface WorkspaceReadResult {
  agentId: string;
  workspace: string;
  file: {
    name: string;
    path: string;
    size: number;
    updatedAtMs: number;
    content: string;
  };
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".md": "markdown",
  ".py": "python",
  ".ts": "typescript",
  ".js": "javascript",
  ".json": "json",
  ".csv": "csv",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sh": "bash",
  ".txt": "text",
  ".html": "html",
  ".css": "css",
  ".xml": "xml",
  ".env": "text",
};

function getLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot < 0) {return "text";}
  const ext = filePath.substring(lastDot).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

// GET /api/instances/[id]/files/content?path=memory/2026-02-20.md
export async function GET(
  request: Request,
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

  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");

  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
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
    console.error("[files/content] Failed to resolve gateway target:", err);
    return NextResponse.json(
      { error: "Failed to resolve gateway credentials" },
      { status: 500 }
    );
  }

  try {
    const result = await gatewayRpc<WorkspaceReadResult>({
      gatewayUrl,
      token,
      method: "workspace.read",
      rpcParams: { agentId: "main", path: filePath },
    });

    if (!result.ok) {
      console.error("[files/content] Gateway error:", result.error);
      return NextResponse.json(
        { error: "Failed to read file", details: result.error },
        { status: 500 }
      );
    }

    const file = result.payload?.file;
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({
      path: file.path,
      name: file.name,
      content: file.content,
      size: file.size,
      language: getLanguage(file.path),
    });
  } catch (err) {
    console.error("[files/content] Error:", err);
    return NextResponse.json(
      { error: "Failed to reach gateway", details: String(err) },
      { status: 500 }
    );
  }
}
