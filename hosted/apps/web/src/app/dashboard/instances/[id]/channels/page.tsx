"use client";

import { use, useEffect, useState, useRef } from "react";

interface Instance {
  id: string;
  status: string;
}

interface ChannelStatus {
  configured?: boolean;
  linked?: boolean;
  enabled?: boolean;
  connected?: boolean;
  running?: boolean;
  authAgeMs?: number | null;
  lastError?: string | null;
  self?: {
    e164?: string | null;
    jid?: string | null;
  };
}

interface ChannelMeta {
  label: string;
  blurb?: string;
  docsUrl?: string;
}

interface ChannelsData {
  channels: Record<string, ChannelStatus>;
  channelMeta: Record<string, ChannelMeta>;
  channelAccounts?: Record<string, ChannelAccountSnapshot[]>;
}

interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

interface ChannelAccountSnapshot {
  accountId: string;
  configured?: boolean;
  enabled?: boolean;
  linked?: boolean;
  probe?: {
    ok?: boolean;
    bot?: {
      username?: string | null;
    };
  };
}

type WhatsAppDebugSnapshot = {
  at?: string;
  error?: string;
  channel?: unknown;
  account?: unknown;
};

type ChannelStatusResponse = {
  channels?: Record<string, ChannelStatus>;
};

const SUPPORTED_CHANNELS = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    color: "#25D366",
    icon: WhatsAppIcon,
    description: "Connect your bot to your WhatsApp account",
    setupMode: "qr",
    setupFields: [],
    docsUrl: "https://docs.openclaw.ai/channels/whatsapp",
    instructions: "Generate a QR code, then scan it in WhatsApp → Linked Devices",
  },
  {
    id: "telegram",
    name: "Telegram",
    color: "#0088cc",
    icon: TelegramIcon,
    description: "Connect your bot to Telegram",
    setupMode: "credentials",
    setupFields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "123456:ABC-DEF...", required: true },
    ],
    docsUrl: "https://docs.openclaw.ai/channels/telegram",
    instructions: "Get your bot token from @BotFather on Telegram",
  },
  {
    id: "discord",
    name: "Discord",
    color: "#5865F2",
    icon: DiscordIcon,
    description: "Connect your bot to Discord servers",
    setupMode: "credentials",
    setupFields: [
      { key: "token", label: "Bot Token", type: "password", placeholder: "Your Discord bot token", required: true },
      { key: "name", label: "Bot Name", type: "text", placeholder: "My Discord Bot", required: false },
    ],
    docsUrl: "https://docs.openclaw.ai/channels/discord",
    instructions: "Get your bot token from the Discord Developer Portal",
  },
];

const COMING_SOON_CHANNELS = [
  { id: "slack", name: "Slack", color: "#4A154B", icon: SlackIcon },
];

function isWhatsAppLoginTerminalFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("logged out") ||
    normalized.includes("expired") ||
    normalized.includes("ended without a connection") ||
    normalized.includes("no active whatsapp login")
  );
}

function isChannelConfigured(status: ChannelStatus | undefined): boolean {
  return status?.configured === true || status?.linked === true;
}

function isWhatsAppRuntimeActive(status: ChannelStatus | undefined): boolean {
  return status?.connected === true || status?.running === true;
}

function formatAuthAge(authAgeMs: number | null | undefined): string | null {
  if (typeof authAgeMs !== "number" || !Number.isFinite(authAgeMs) || authAgeMs < 0) {
    return null;
  }
  const minutes = Math.floor(authAgeMs / 60_000);
  if (minutes < 1) {
    return "linked just now";
  }
  if (minutes < 60) {
    return `linked ${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `linked ${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `linked ${days}d ago`;
}

export default function InstanceChannelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: instanceId } = use(params);

  const [instance, setInstance] = useState<Instance | null>(null);
  const [channelsData, setChannelsData] = useState<ChannelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pairingRequests, setPairingRequests] = useState<Record<string, PairingRequest[]>>({});
  const [approvingCode, setApprovingCode] = useState<string | null>(null);
  const [botUsernames, setBotUsernames] = useState<Record<string, string>>({});
  const [gatewayRestarting, setGatewayRestarting] = useState(false);
  const [approvedChannels, setApprovedChannels] = useState<Set<string>>(new Set());
  const [whatsappQrDataUrl, setWhatsappQrDataUrl] = useState<string | null>(null);
  const [waitingForWhatsAppScan, setWaitingForWhatsAppScan] = useState(false);
  const [whatsappDebug, setWhatsappDebug] = useState<WhatsAppDebugSnapshot | null>(null);
  const hasProbed = useRef(false);
  const whatsappLoginAttemptRef = useRef(0);
  const whatsappRecoveryInFlightRef = useRef(false);
  const whatsappLastRecoveryAtRef = useRef(0);

  useEffect(() => {
    void fetchInstance();
  }, [instanceId]);

  useEffect(() => {
    if (!instance || instance.status !== "running" || !channelsData) {return;}

    const configuredChannels = SUPPORTED_CHANNELS.filter((channel) => {
      const status = channelsData.channels?.[channel.id];
      return isChannelConfigured(status);
    });

    if (configuredChannels.length === 0) {return;}

    const interval = setInterval(() => {
      for (const channel of configuredChannels) {
        void fetchPairingRequests(instance.id, channel.id);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [instance, channelsData]);

  useEffect(() => {
    if (!instance || instance.status !== "running" || !channelsData || hasProbed.current) {return;}

    const hasConfiguredChannels = SUPPORTED_CHANNELS.some((channel) => {
      const status = channelsData.channels?.[channel.id];
      return isChannelConfigured(status);
    });

    if (hasConfiguredChannels) {
      hasProbed.current = true;
      void fetchChannels(instance.id, true);
    }
  }, [instance, channelsData]);

  useEffect(() => {
    if (!instance || instance.status !== "running" || !channelsData) {
      return;
    }
    const status = channelsData.channels?.whatsapp;
    const shouldRecover =
      Boolean(status?.linked) &&
      !isWhatsAppRuntimeActive(status) &&
      !whatsappRecoveryInFlightRef.current &&
      Date.now() - whatsappLastRecoveryAtRef.current > 10_000 &&
      !waitingForWhatsAppScan &&
      !whatsappQrDataUrl;
    if (!shouldRecover) {
      return;
    }

    whatsappRecoveryInFlightRef.current = true;
    whatsappLastRecoveryAtRef.current = Date.now();
    void (async () => {
      try {
        const response = await fetch(
          `/api/instances/${instance.id}/channels/whatsapp/login/wait`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeoutMs: 2000 }),
          },
        );
        const data = await response.json().catch(() => ({}));
        setWhatsappDebug((data?.debug as WhatsAppDebugSnapshot | undefined) ?? null);
        if (response.ok && data?.connected === true) {
          setSuccess("WhatsApp session recovered.");
          setTimeout(() => setSuccess(null), 3000);
          void fetchChannels(instance.id, true);
        }
      } catch (err) {
        console.error("Error recovering WhatsApp session:", err);
      } finally {
        whatsappRecoveryInFlightRef.current = false;
      }
    })();
  }, [instance, channelsData, waitingForWhatsAppScan, whatsappQrDataUrl]);

  async function fetchInstance() {
    try {
      const response = await fetch("/api/instances");
      const data = await response.json();
      if (data.instances && data.instances.length > 0) {
        const inst = (data.instances as Instance[]).find((i) => i.id === instanceId);
        if (inst) {
          setInstance(inst);
          if (inst.status === "running") {
            void fetchChannels(inst.id);
            return;
          }
        }
      }
      setLoading(false);
    } catch (err) {
      console.error("Error fetching instance:", err);
      setLoading(false);
    }
  }

  async function fetchChannels(instId: string, withProbe = false, retryCount = 0) {
    try {
      let url = withProbe
        ? `/api/instances/${instId}/channels?probe=true`
        : `/api/instances/${instId}/channels`;
      let response = await fetch(url);

      if (!response.ok && withProbe) {
        url = `/api/instances/${instId}/channels`;
        response = await fetch(url);
      }

      if (response.status === 503 && retryCount < 5) {
        setTimeout(() => {
          void fetchChannels(instId, withProbe, retryCount + 1);
        }, 3000);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setChannelsData(data);

        if (data.channelAccounts) {
          const usernames: Record<string, string> = {};
          for (const [channelId, accounts] of Object.entries(data.channelAccounts)) {
            const accountList = accounts as ChannelAccountSnapshot[];
            for (const account of accountList) {
              if (account.probe?.bot?.username) {
                usernames[channelId] = account.probe.bot.username;
                break;
              }
            }
          }
          if (Object.keys(usernames).length > 0) {
            setBotUsernames(prev => ({ ...prev, ...usernames }));
          }
        }

        for (const channel of SUPPORTED_CHANNELS) {
          const status = data.channels?.[channel.id];
          if (isChannelConfigured(status)) {
            void fetchPairingRequests(instId, channel.id);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching channels:", err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPairingRequests(instId: string, channelId: string) {
    try {
      const response = await fetch(`/api/instances/${instId}/channels/${channelId}/pairing`);
      const data = await response.json();
      if (response.ok) {
        setPairingRequests((prev) => ({
          ...prev,
          [channelId]: data.requests || [],
        }));
      }
    } catch (err) {
      console.error(`Error fetching pairing requests for ${channelId}:`, err);
    }
  }

  async function fetchWhatsAppStatus(instId: string): Promise<ChannelStatus | null> {
    try {
      let response = await fetch(`/api/instances/${instId}/channels?probe=true`);
      if (!response.ok) {
        response = await fetch(`/api/instances/${instId}/channels`);
      }
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as ChannelStatusResponse;
      return data.channels?.whatsapp ?? null;
    } catch {
      return null;
    }
  }

  async function clearPairingRequests(channelId: string) {
    if (!instance) {return;}
    try {
      const response = await fetch(
        `/api/instances/${instance.id}/channels/${channelId}/pairing/clear`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Failed to clear pairing requests");
        return;
      }
      setPairingRequests((prev) => ({ ...prev, [channelId]: [] }));
      setSuccess("Pairing requests cleared.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError("Failed to clear pairing requests");
    }
  }

  async function approvePairingRequest(channelId: string, code: string) {
    if (!instance) {return;}
    setApprovingCode(code);
    setError(null);

    try {
      const response = await fetch(`/api/instances/${instance.id}/channels/${channelId}/pairing/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, notify: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to approve pairing request");
        return;
      }

      setApprovedChannels(prev => new Set([...prev, channelId]));
      void fetchPairingRequests(instance.id, channelId);
      void fetchChannels(instance.id, false);

      setSuccess(`Pairing approved! The user can now chat with your bot.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError("Failed to approve pairing request");
      console.error(err);
    } finally {
      setApprovingCode(null);
    }
  }

  async function waitForWhatsAppLogin(
    timeoutMs = 15_000,
    retryCount = 0,
    autoContinue = true
  ) {
    if (!instance) {return;}
    const currentStatus = await fetchWhatsAppStatus(instance.id);
    if (currentStatus?.connected) {
      setWhatsappQrDataUrl(null);
      setSuccess("WhatsApp is already linked and ready.");
      setTimeout(() => setSuccess(null), 4000);
      void fetchChannels(instance.id, true);
      return;
    }
    const attemptId = ++whatsappLoginAttemptRef.current;
    setWaitingForWhatsAppScan(true);

    try {
      const response = await fetch(`/api/instances/${instance.id}/channels/whatsapp/login/wait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs }),
      });
      const data = await response.json();
      setWhatsappDebug((data?.debug as WhatsAppDebugSnapshot | undefined) ?? null);

      if (whatsappLoginAttemptRef.current !== attemptId) {
        return;
      }

      if (!response.ok) {
        if (response.status === 503 && data.retryable && retryCount < 3) {
          setGatewayRestarting(true);
          setTimeout(() => {
            void waitForWhatsAppLogin(timeoutMs, retryCount + 1);
          }, 3000);
          return;
        }
        setGatewayRestarting(false);
        setError(
          data.details
            ? `${data.error || "Failed to verify WhatsApp login"}: ${data.details}`
            : (data.error || "Failed to verify WhatsApp login")
        );
        return;
      }

      setGatewayRestarting(false);
      if (data.connected) {
        setWhatsappQrDataUrl(null);
        setSuccess(data.message || "WhatsApp linked successfully!");
        setTimeout(() => setSuccess(null), 5000);
        void fetchChannels(instance.id, true);
        return;
      }

      const message =
        typeof data.message === "string" && data.message.trim()
          ? data.message.trim()
          : "Still waiting for QR scan.";

      if (message.toLowerCase().includes("login failed")) {
        if (message.includes("status=515")) {
          setSuccess("WhatsApp requested a restart. Still finalizing login, keep WhatsApp open...");
          setTimeout(() => setSuccess(null), 4000);
          if (autoContinue && whatsappQrDataUrl) {
            whatsappLoginAttemptRef.current += 1;
            setTimeout(() => {
              void waitForWhatsAppLogin(15_000, 0, true);
            }, 2000);
          }
          return;
        }
        const status = await fetchWhatsAppStatus(instance.id);
        if (status?.connected) {
          setWhatsappQrDataUrl(null);
          setSuccess("WhatsApp is linked and connected.");
          setTimeout(() => setSuccess(null), 5000);
          void fetchChannels(instance.id, true);
          return;
        }
        setError(`${message} Please generate a new QR and scan again.`);
        return;
      }

      if (message.toLowerCase().includes("no active whatsapp login")) {
        const status = await fetchWhatsAppStatus(instance.id);
        if (status?.connected) {
          setWhatsappQrDataUrl(null);
          setSuccess("WhatsApp is already linked and ready.");
          setTimeout(() => setSuccess(null), 5000);
          void fetchChannels(instance.id, true);
          return;
        }
        if (whatsappQrDataUrl && retryCount < 1) {
          setSuccess("Login session expired. Generating a fresh QR…");
          setTimeout(() => setSuccess(null), 3000);
          await startWhatsAppLogin(true);
          return;
        }
      }

      if (isWhatsAppLoginTerminalFailure(message)) {
        setWhatsappQrDataUrl(null);
        setError(`${message} Generate a new QR and scan again.`);
        return;
      }

      setSuccess(message);
      setTimeout(() => setSuccess(null), 3000);
      if (autoContinue && whatsappQrDataUrl) {
        // Reserve the next polling attempt immediately so the current `finally`
        // block does not briefly flip the UI back to idle between polls.
        whatsappLoginAttemptRef.current += 1;
        setTimeout(() => {
          void waitForWhatsAppLogin(15_000, 0, true);
        }, 2000);
      }
    } catch (err) {
      if (whatsappLoginAttemptRef.current !== attemptId) {
        return;
      }
      setGatewayRestarting(false);
      setError("Failed to verify WhatsApp login");
      console.error(err);
    } finally {
      if (whatsappLoginAttemptRef.current === attemptId) {
        setWaitingForWhatsAppScan(false);
        setConfiguring((prev) => (prev === "whatsapp" ? null : prev));
      }
    }
  }

  async function startWhatsAppLogin(force = false, retryCount = 0) {
    if (!instance) {return;}
    const currentStatus = await fetchWhatsAppStatus(instance.id);
    if (currentStatus?.connected) {
      setWhatsappQrDataUrl(null);
      setConfiguring(null);
      setSuccess("WhatsApp is already linked and ready.");
      setTimeout(() => setSuccess(null), 4000);
      void fetchChannels(instance.id, true);
      return;
    }
    whatsappLoginAttemptRef.current += 1;
    setWaitingForWhatsAppScan(false);
    setWhatsappDebug(null);
    setConfiguring("whatsapp");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/instances/${instance.id}/channels/whatsapp/login/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, timeoutMs: 30000 }),
      });
      const data = await response.json();
      setWhatsappDebug((data?.debug as WhatsAppDebugSnapshot | undefined) ?? null);

      if (!response.ok) {
        const statusAfterError = await fetchWhatsAppStatus(instance.id);
        if (statusAfterError?.connected || statusAfterError?.linked) {
          setGatewayRestarting(false);
          setConfiguring(null);
          setWhatsappQrDataUrl(null);
          setError(null);
          setSuccess(
            isWhatsAppRuntimeActive(statusAfterError)
              ? "WhatsApp is already linked and ready."
              : "WhatsApp is linked, but reconnecting in progress.",
          );
          setTimeout(() => setSuccess(null), 5000);
          void fetchChannels(instance.id, true);
          return;
        }
        if (response.status === 503 && data.retryable && retryCount < 3) {
          setGatewayRestarting(true);
          setTimeout(() => {
            void startWhatsAppLogin(force, retryCount + 1);
          }, 3000);
          return;
        }
        setGatewayRestarting(false);
        setConfiguring(null);
        setError(
          data.details
            ? `${data.error || "Failed to start WhatsApp login"}: ${data.details}`
            : (data.error || "Failed to start WhatsApp login")
        );
        return;
      }

      setGatewayRestarting(false);
      if (typeof data.qrDataUrl === "string" && data.qrDataUrl.length > 0) {
        setWhatsappQrDataUrl(data.qrDataUrl);
        setSuccess(data.message || "Scan the QR code in WhatsApp. We'll keep checking automatically.");
        setTimeout(() => setSuccess(null), 5000);
        void waitForWhatsAppLogin(15_000, 0, true);
        return;
      }

      setConfiguring(null);
      setWhatsappQrDataUrl(null);
      if (typeof data.message === "string" && data.message.length > 0) {
        const message = data.message.trim();
        if (message.toLowerCase().includes("already linked")) {
          const status = await fetchWhatsAppStatus(instance.id);
          if (status?.connected) {
            setSuccess(message);
            setTimeout(() => setSuccess(null), 5000);
            void fetchChannels(instance.id, true);
            return;
          }
          if (!force) {
            setSuccess("Existing link looks stale. Generating a fresh QR…");
            setTimeout(() => setSuccess(null), 3000);
            await startWhatsAppLogin(true);
            return;
          }
        }
        setSuccess(message);
        setTimeout(() => setSuccess(null), 5000);
      }
      void fetchChannels(instance.id, true);
    } catch (err) {
      setGatewayRestarting(false);
      setConfiguring(null);
      setError("Failed to start WhatsApp login");
      console.error(err);
    }
  }

  async function configureChannel(channelId: string, retryCount = 0) {
    if (!instance) {return;}

    setError(null);
    setSuccess(null);

    if (channelId === "whatsapp") {
      await startWhatsAppLogin(retryCount > 0);
      return;
    }

    const channel = SUPPORTED_CHANNELS.find((c) => c.id === channelId);
    if (!channel) {return;}

    for (const field of channel.setupFields) {
      if (field.required && !formData[field.key]?.trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }

    setConfiguring(channelId);

    try {
      const response = await fetch(`/api/instances/${instance.id}/channels/${channelId}/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 503 && data.retryable && retryCount < 3) {
          setGatewayRestarting(true);
          setTimeout(() => {
            void configureChannel(channelId, retryCount + 1);
          }, 3000);
          return;
        }

        setGatewayRestarting(false);
        if (response.status === 503) {
          setError("Gateway is still restarting. Please wait a moment and try again.");
        } else {
          setError(data.error || "Failed to configure channel");
        }
        return;
      }

      setGatewayRestarting(false);
      setSuccess(`${channel.name} bot connected! Now message your bot to complete pairing.`);
      setFormData({});
      setTimeout(() => setSuccess(null), 6000);

      setTimeout(() => {
        void fetchChannels(instance.id, false);
      }, 3000);

      setTimeout(() => {
        hasProbed.current = false;
        void fetchChannels(instance.id, true);
      }, 8000);
    } catch (err) {
      setGatewayRestarting(false);
      setError("Failed to configure channel");
      console.error(err);
    } finally {
      setConfiguring(null);
    }
  }

  async function disableChannel(channelId: string) {
    if (!instance) {return;}
    if (!confirm(`Are you sure you want to disable ${channelId}?`)) {return;}

    try {
      const response = await fetch(`/api/instances/${instance.id}/channels/${channelId}/configure`, {
        method: "DELETE",
      });

      if (response.ok) {
        if (channelId === "whatsapp") {
          setWhatsappQrDataUrl(null);
          setWaitingForWhatsAppScan(false);
          setWhatsappDebug(null);
          whatsappLoginAttemptRef.current += 1;
        }
        setApprovedChannels(prev => {
          const next = new Set(prev);
          next.delete(channelId);
          return next;
        });
        setSuccess(`${channelId} disconnected`);
        setTimeout(() => setSuccess(null), 3000);
        setTimeout(() => void fetchChannels(instance.id), 3000);
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-light border-t-primary animate-spin" />
          <p className="text-foreground-muted">Loading channels...</p>
        </div>
      </div>
    );
  }

  if (!instance || instance.status !== "running") {
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Channels</h1>
          <p className="mt-1 text-foreground-muted">Connect your bot to messaging platforms</p>
        </div>

        <div className="bg-background-secondary rounded-2xl border border-border p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-warning-light flex items-center justify-center mb-4">
            <AlertIcon className="w-8 h-8 text-warning" />
          </div>
          <p className="text-foreground-muted font-medium">Bot not running</p>
          <p className="text-sm text-foreground-subtle mt-1">
            Your bot needs to be running before you can configure channels.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Channels</h1>
        <p className="mt-1 text-foreground-muted">Connect your bot to messaging platforms</p>
      </div>

      {success && (
        <div className="bg-success-light border border-success/30 rounded-xl p-4 flex items-center gap-3">
          <CheckIcon className="w-5 h-5 text-success flex-shrink-0" />
          <p className="text-success-dark text-sm">{success}</p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-success-dark/60 hover:text-success-dark">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-error-light border border-error/30 rounded-xl p-4 flex items-center gap-3">
          <AlertIcon className="w-5 h-5 text-error flex-shrink-0" />
          <p className="text-error-dark text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-error-dark/60 hover:text-error-dark">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Available Channels</h2>

        <div className="grid gap-4">
          {SUPPORTED_CHANNELS.map((channel) => {
            const status = channelsData?.channels?.[channel.id];
            const isConfigured = isChannelConfigured(status);
            const Icon = channel.icon;

            return (
              <div
                key={channel.id}
                className="bg-background-secondary rounded-2xl border border-border overflow-hidden"
              >
                <div className="p-6 flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${channel.color}15` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: channel.color }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-foreground">{channel.name}</h3>
                      {isConfigured && (() => {
                        const hasLinkedUsers =
                          channel.id === "whatsapp"
                            ? Boolean(isWhatsAppRuntimeActive(status) || approvedChannels.has(channel.id))
                            : Boolean(status?.linked || approvedChannels.has(channel.id));
                        return (
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                            hasLinkedUsers
                              ? "bg-success-light text-success-dark"
                              : "bg-warning-light text-warning-dark"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${hasLinkedUsers ? "bg-success" : "bg-warning"}`} />
                            {hasLinkedUsers ? "Active" : "Awaiting pairing"}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-foreground-muted">{channel.description}</p>
                    {channel.id === "whatsapp" && isConfigured && (
                      <div className="mt-1 text-xs text-foreground-subtle">
                        {status?.self?.e164 || status?.self?.jid ? (
                          <span>
                            Connected as{" "}
                            <span className="font-mono">
                              {status?.self?.e164 || status?.self?.jid}
                            </span>
                          </span>
                        ) : (
                          <span>Connected account details unavailable</span>
                        )}
                        {(status?.connected || status?.running) && (
                          <span className="ml-2">
                            ({status?.connected ? "connected" : "starting"})
                          </span>
                        )}
                        {formatAuthAge(status?.authAgeMs) && (
                          <span className="ml-2">• {formatAuthAge(status?.authAgeMs)}</span>
                        )}
                        {status?.lastError && <span className="ml-2 text-warning">• {status.lastError}</span>}
                      </div>
                    )}
                  </div>
                  {isConfigured && (
                    <button
                      onClick={() => disableChannel(channel.id)}
                      className="px-3 py-1.5 rounded-lg text-sm text-foreground-muted hover:text-error hover:bg-error-light transition-colors"
                    >
                      Disconnect
                    </button>
                  )}
                </div>

                {isConfigured && (
                  <div className="border-t border-border p-6 bg-background">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <UserPlusIcon className="w-5 h-5 text-foreground-muted" />
                        <h4 className="font-medium text-foreground">Pairing Requests</h4>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => void clearPairingRequests(channel.id)}
                          className="text-sm text-foreground-muted hover:text-error transition-colors"
                        >
                          Clear all
                        </button>
                        <button
                          onClick={() => instance && fetchPairingRequests(instance.id, channel.id)}
                          className="text-sm text-primary hover:underline"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>

                    {channel.id === "whatsapp" && whatsappDebug && (
                      <details className="rounded-xl border border-border bg-background-secondary p-3 mb-4">
                        <summary className="cursor-pointer text-xs font-medium text-foreground-muted">
                          WhatsApp debug snapshot
                        </summary>
                        <pre className="mt-2 text-[11px] leading-4 text-foreground-subtle overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(whatsappDebug, null, 2)}
                        </pre>
                      </details>
                    )}

                    {(pairingRequests[channel.id]?.length ?? 0) === 0 ? (
                      <div className="text-center py-8 text-foreground-muted">
                        {(channel.id === "whatsapp"
                          ? Boolean(isWhatsAppRuntimeActive(status) || approvedChannels.has(channel.id))
                          : Boolean(status?.linked || approvedChannels.has(channel.id))) ? (
                          <>
                            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-light flex items-center justify-center">
                              <CheckIcon className="w-6 h-6 text-success" />
                            </div>
                            <p className="text-sm font-medium text-foreground">Users connected</p>
                            <p className="text-xs mt-1 text-foreground-subtle">
                              Your bot is ready to receive messages
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm">No pending pairing requests</p>
                            <p className="text-xs mt-1 text-foreground-subtle">
                              When someone messages your bot, their request will appear here for approval
                            </p>
                            {channel.id === "telegram" && botUsernames.telegram && (
                              <a
                                href={`https://t.me/${botUsernames.telegram}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-[#0088cc] text-white text-sm font-medium hover:bg-[#0077b5] transition-colors"
                              >
                                <TelegramIcon className="w-4 h-4" />
                                Open @{botUsernames.telegram} in Telegram
                                <ExternalLinkIcon className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pairingRequests[channel.id]?.map((request) => (
                          <div
                            key={request.code}
                            className="flex items-center justify-between p-4 rounded-xl bg-background-secondary border border-border"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium text-primary bg-primary-light px-2 py-0.5 rounded">
                                  {request.code}
                                </span>
                                {request.meta?.username && (
                                  <span className="text-sm text-foreground">
                                    @{request.meta.username}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-foreground-subtle">
                                {request.meta?.firstName && (
                                  <span>
                                    {request.meta.firstName}
                                    {request.meta.lastName ? ` ${request.meta.lastName}` : ""}
                                  </span>
                                )}
                                <span>ID: {request.id}</span>
                                <span>{new Date(request.createdAt).toLocaleString()}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => approvePairingRequest(channel.id, request.code)}
                              disabled={approvingCode === request.code}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-white text-sm font-medium hover:bg-success/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {approvingCode === request.code ? (
                                <>
                                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                  Approving...
                                </>
                              ) : (
                                <>
                                  <CheckIcon className="w-4 h-4" />
                                  Approve
                                </>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!isConfigured && (
                  <div className="border-t border-border p-6 bg-background">
                    <p className="text-sm text-foreground-muted mb-4">{channel.instructions}</p>

                    {channel.setupMode === "credentials" && (
                      <div className="space-y-4">
                        {channel.setupFields.map((field) => (
                          <div key={field.key}>
                            <label className="block text-sm font-medium text-foreground mb-1.5">
                              {field.label}
                              {field.required && <span className="text-error ml-0.5">*</span>}
                            </label>
                            <input
                              type={field.type}
                              placeholder={field.placeholder}
                              value={formData[field.key] || ""}
                              onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                              className="w-full px-4 py-2.5 rounded-xl bg-background-secondary border border-border text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {channel.id === "whatsapp" && whatsappQrDataUrl && (
                      <div className="rounded-xl border border-border bg-background-secondary p-4 mb-4">
                        <div className="flex flex-col items-center gap-3">
                          <img
                            src={whatsappQrDataUrl}
                            alt="WhatsApp QR code"
                            className="w-56 h-56 rounded-lg bg-white p-2 border border-border"
                          />
                          <p className="text-xs text-foreground-subtle text-center">
                            Open WhatsApp on your phone, go to Linked Devices, and scan this QR.
                          </p>
                        </div>
                      </div>
                    )}

                    {channel.id === "whatsapp" && whatsappDebug && (
                      <details className="rounded-xl border border-border bg-background-secondary p-3 mb-4">
                        <summary className="cursor-pointer text-xs font-medium text-foreground-muted">
                          WhatsApp debug snapshot
                        </summary>
                        <pre className="mt-2 text-[11px] leading-4 text-foreground-subtle overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(whatsappDebug, null, 2)}
                        </pre>
                      </details>
                    )}

                    <div className="flex items-center gap-3 mt-6">
                      <button
                        onClick={() => configureChannel(channel.id)}
                        disabled={configuring === channel.id}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {configuring === channel.id || waitingForWhatsAppScan ? (
                          <>
                            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            {gatewayRestarting ? "Waiting for gateway..." : "Waiting for WhatsApp..."}
                          </>
                        ) : (
                          <>
                            <LinkIcon className="w-4 h-4" />
                            {channel.id === "whatsapp" ? "Generate QR" : `Connect ${channel.name}`}
                          </>
                        )}
                      </button>

                      {channel.id === "whatsapp" && whatsappQrDataUrl && (
                        <button
                          onClick={() => void waitForWhatsAppLogin(45_000, 0, false)}
                          disabled={waitingForWhatsAppScan}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-foreground font-medium hover:bg-background-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {waitingForWhatsAppScan ? "Checking..." : "I've scanned QR"}
                        </button>
                      )}

                      {channel.docsUrl && (
                        <a
                          href={channel.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          View setup guide
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground-muted">Coming Soon</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {COMING_SOON_CHANNELS.map((channel) => {
            const Icon = channel.icon;
            return (
              <div
                key={channel.id}
                className="bg-background-secondary/50 rounded-2xl border border-border/50 p-6 flex items-center gap-4 opacity-60"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${channel.color}10` }}
                >
                  <Icon className="w-6 h-6" style={{ color: channel.color }} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{channel.name}</h3>
                  <p className="text-sm text-foreground-subtle">Coming soon</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Icons
function TelegramIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

function DiscordIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/>
    </svg>
  );
}

function WhatsAppIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function SlackIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

function UserPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
