import { listChannelPlugins } from "../../channels/plugins/index.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);
const LINK_DETECTION_MAX_WAIT_MS = 30_000;
const LINK_DETECTION_POLL_MS = 1_000;
const START_AFTER_LINK_MAX_WAIT_MS = 20_000;
const START_AFTER_LINK_POLL_MS = 1_000;

const resolveWebLoginProvider = () =>
  listChannelPlugins().find((plugin) =>
    (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
  ) ?? null;

function resolveAccountId(params: unknown): string | undefined {
  return typeof (params as { accountId?: unknown }).accountId === "string"
    ? (params as { accountId?: string }).accountId
    : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoActiveLoginError(error: unknown): boolean {
  const message = formatForLog(error).toLowerCase();
  return (
    message.includes("no active whatsapp login") ||
    message.includes("no login in progress") ||
    message.includes("login session expired")
  );
}

async function detectLinkedAccount(params: {
  provider: NonNullable<ReturnType<typeof resolveWebLoginProvider>>;
  accountId?: string;
}): Promise<boolean> {
  const deadline = Date.now() + LINK_DETECTION_MAX_WAIT_MS;
  while (Date.now() <= deadline) {
    const cfg = loadConfig();
    const account = params.provider.config.resolveAccount(cfg, params.accountId);
    const linked = params.provider.config.isConfigured
      ? await params.provider.config.isConfigured(account, cfg)
      : false;
    if (linked) {
      return true;
    }
    await sleep(LINK_DETECTION_POLL_MS);
  }
  return false;
}

function isChannelActive(params: {
  context: Parameters<GatewayRequestHandlers["web.login.start"]>[0]["context"];
  providerId: string;
  accountId?: string;
}): boolean {
  const snapshot = params.context.getRuntimeSnapshot();
  const channelRuntime = snapshot.channels[params.providerId as keyof typeof snapshot.channels];
  const accountRuntime = params.accountId
    ? snapshot.channelAccounts[params.providerId as keyof typeof snapshot.channelAccounts]?.[
        params.accountId
      ]
    : undefined;
  const runtime = accountRuntime ?? channelRuntime;
  return runtime?.connected === true || runtime?.running === true;
}

async function ensureChannelStartedAfterLink(params: {
  context: Parameters<GatewayRequestHandlers["web.login.start"]>[0]["context"];
  providerId: string;
  accountId?: string;
}): Promise<boolean> {
  const deadline = Date.now() + START_AFTER_LINK_MAX_WAIT_MS;
  while (Date.now() <= deadline) {
    await params.context.startChannel(params.providerId as never, params.accountId);
    if (isChannelActive(params)) {
      return true;
    }
    await sleep(START_AFTER_LINK_POLL_MS);
    if (isChannelActive(params)) {
      return true;
    }
  }
  return isChannelActive(params);
}

function respondProviderUnavailable(respond: RespondFn) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
  );
}

function respondProviderUnsupported(respond: RespondFn, providerId: string) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `web login is not supported by provider ${providerId}`),
  );
}

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      const linked = await detectLinkedAccount({ provider, accountId });
      if (linked) {
        await ensureChannelStartedAfterLink({
          context,
          providerId: provider.id,
          accountId,
        });
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      let result: { connected: boolean; message: string };
      try {
        result = await provider.gateway.loginWithQrWait({
          timeoutMs:
            typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
              ? (params as { timeoutMs?: number }).timeoutMs
              : undefined,
          accountId,
        });
      } catch (err) {
        // Login waiter can expire while creds are already persisted after scan.
        // Recover by checking linked auth and starting the channel directly.
        if (!isNoActiveLoginError(err)) {
          throw err;
        }
        const linkedAfterWaitError = await detectLinkedAccount({ provider, accountId });
        if (!linkedAfterWaitError) {
          throw err;
        }
        const startedAfterWaitError = await ensureChannelStartedAfterLink({
          context,
          providerId: provider.id,
          accountId,
        });
        respond(
          true,
          {
            connected: startedAfterWaitError,
            message: startedAfterWaitError
              ? "Linked session detected after waiter expiry; channel restarted."
              : "Linked session detected, but channel startup is still pending.",
          },
          undefined,
        );
        return;
      }
      if (result.connected) {
        await ensureChannelStartedAfterLink({
          context,
          providerId: provider.id,
          accountId,
        });
        respond(true, result, undefined);
        return;
      }

      // Some WhatsApp pairings persist creds but still end the QR waiter with a
      // transient stream-restart error (e.g. status 515). If creds are linked,
      // start the channel and treat this as successful completion for UI flow.
      const linked = await detectLinkedAccount({ provider, accountId });
      if (linked) {
        const started = await ensureChannelStartedAfterLink({
          context,
          providerId: provider.id,
          accountId,
        });
        if (!started) {
          respond(
            true,
            {
              ...result,
              connected: false,
              message:
                "Linked session detected, but channel startup is still pending. Keeping login in progress.",
            },
            undefined,
          );
          return;
        }
        respond(
          true,
          {
            ...result,
            connected: true,
            message:
              result.message && result.message.trim()
                ? `${result.message} Linked session detected; starting channel.`
                : "Linked session detected; starting channel.",
          },
          undefined,
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
