import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { gatewayRpc } from "@/lib/gateway/ws-client";
import { resolveGatewayTarget } from "@/lib/gateway/target";
import { decryptGatewayToken } from "@/lib/crypto";

// Supported channels and their config structure
const CHANNEL_CONFIGS: Record<string, (body: Record<string, unknown>) => Record<string, unknown>> = {
  telegram: (body) => ({
    channels: {
      telegram: {
        enabled: true,
        botToken: body.botToken,
        dmPolicy: "pairing", // Secure by default - requires pairing approval
      },
    },
  }),
  discord: (body) => ({
    channels: {
      discord: {
        enabled: true,
        token: body.token,
        accounts: {
          default: {
            name: body.name || "Discord Bot",
            dm: {
              enabled: true,
              policy: body.dmPolicy || "pairing",
            },
          },
        },
      },
    },
  }),
};

// POST /api/instances/[id]/channels/[channel]/configure
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; channel: string }> }
) {
  const { id, channel } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate channel
  if (!CHANNEL_CONFIGS[channel]) {
    return NextResponse.json(
      { error: "Unsupported channel", supported: Object.keys(CHANNEL_CONFIGS) },
      { status: 400 }
    );
  }

  // Get instance from database
  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  const body = await request.json();

  try {
    // Step 1: Get current config to get baseHash
    console.log("[channels/configure] Getting config from gateway:", gatewayUrl);
    const configResult = await gatewayRpc<{
      hash?: string;
      config?: Record<string, unknown>;
    }>({
      gatewayUrl,
      token,
      method: "config.get",
      rpcParams: {},
    });

    console.log("[channels/configure] Config result:", configResult.ok, configResult.error);

    if (!configResult.ok) {
      console.error("[channels/configure] Failed to get config:", configResult.error);
      // Check for service unavailable (503) or gateway timeout (504)
      const errorStr = String(configResult.error || "");
      if (errorStr.includes("503") || errorStr.includes("502") || errorStr.includes("504")) {
        return NextResponse.json(
          { error: "Gateway is restarting", details: "Please wait a moment and try again.", retryable: true },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Failed to get config", details: configResult.error },
        { status: 500 }
      );
    }

    const baseHash = configResult.payload?.hash;
    console.log("[channels/configure] Got baseHash:", baseHash ? "yes" : "no");
    if (!baseHash) {
      return NextResponse.json(
        { error: "Config hash not available", payload: configResult.payload },
        { status: 500 }
      );
    }

    // Step 2: Build channel config patch
    const configPatch = CHANNEL_CONFIGS[channel](body);
    console.log("[channels/configure] Config patch:", JSON.stringify(configPatch));

    // Step 3: Apply config patch
    console.log("[channels/configure] Applying config patch...");
    const patchResult = await gatewayRpc<{
      ok: boolean;
      config?: Record<string, unknown>;
      restart?: { scheduled: boolean };
    }>({
      gatewayUrl,
      token,
      method: "config.patch",
      rpcParams: {
        baseHash,
        raw: JSON.stringify(configPatch),
        restartDelayMs: 1000,
      },
    });

    console.log("[channels/configure] Patch result:", patchResult.ok, patchResult.error, JSON.stringify(patchResult.payload));

    if (!patchResult.ok) {
      console.error("[channels/configure] Failed to patch config:", patchResult.error);
      return NextResponse.json(
        { error: "Failed to configure channel", details: patchResult.error },
        { status: 500 }
      );
    }

    console.log("[channels/configure] Channel configured successfully");
    return NextResponse.json({
      ok: true,
      channel,
      configured: true,
      restart: patchResult.payload?.restart,
    });
  } catch (error) {
    console.error("[channels/configure] Error:", error);
    return NextResponse.json(
      { error: "Failed to configure channel", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/instances/[id]/channels/[channel]/configure - Disable channel
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; channel: string }> }
) {
  const { id, channel } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get instance from database
  const { data: instance, error } = await supabase
    .from("instances")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!instance.public_url || instance.status !== "running") {
    return NextResponse.json({ error: "Instance not ready" }, { status: 400 });
  }

  const { gatewayUrl, token } = resolveGatewayTarget({
    instancePublicUrl: instance.public_url,
    instanceToken: decryptGatewayToken(instance.gateway_token_encrypted),
    instanceId: id,
  });

  try {
    if (channel === "whatsapp") {
      const logoutResult = await gatewayRpc<{ channel?: string; cleared?: boolean }>({
        gatewayUrl,
        token,
        method: "channels.logout",
        rpcParams: { channel },
      });
      if (!logoutResult.ok) {
        console.log("[channels/configure] WhatsApp logout failed:", logoutResult.error);
      } else {
        console.log("[channels/configure] WhatsApp logout result:", logoutResult.payload);
      }
    }

    // Step 1: Clear pairing data (approved users) for this channel
    console.log("[channels/configure] Clearing pairing data for channel:", channel);
    const clearResult = await gatewayRpc<{ ok: boolean; cleared?: boolean; previousCount?: number }>({
      gatewayUrl,
      token,
      method: "channel.pairing.clear",
      rpcParams: { channel },
    });

    if (!clearResult.ok) {
      console.log("[channels/configure] Clear pairing failed:", clearResult.error);
    } else {
      console.log("[channels/configure] Clear pairing result:", clearResult.payload);
    }

    // Step 2: Get current config
    const configResult = await gatewayRpc<{
      hash?: string;
    }>({
      gatewayUrl,
      token,
      method: "config.get",
      rpcParams: {},
    });

    if (!configResult.ok) {
      return NextResponse.json(
        { error: "Failed to get config", details: configResult.error },
        { status: 500 }
      );
    }

    const baseHash = configResult.payload?.hash;
    if (!baseHash) {
      return NextResponse.json(
        { error: "Config hash not available" },
        { status: 500 }
      );
    }

    // Step 3: Remove channel config entirely (set to null to delete)
    const patchResult = await gatewayRpc<{ ok: boolean }>({
      gatewayUrl,
      token,
      method: "config.patch",
      rpcParams: {
        baseHash,
        raw: JSON.stringify({
          channels: {
            [channel]: null, // null removes the key in merge-patch
          },
        }),
        restartDelayMs: 1000,
      },
    });

    if (!patchResult.ok) {
      return NextResponse.json(
        { error: "Failed to disable channel", details: patchResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, channel, disabled: true });
  } catch (error) {
    console.error("[channels/configure] Error:", error);
    return NextResponse.json(
      { error: "Failed to disable channel", details: String(error) },
      { status: 500 }
    );
  }
}
