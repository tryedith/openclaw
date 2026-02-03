import { loadConfig } from "../../config/config.js";
import {
  listPairingChannels,
  notifyPairingApproved,
  resolvePairingChannel,
} from "../../channels/plugins/pairing.js";
import {
  approveChannelPairingCode,
  clearChannelAllowFromStore,
  listChannelPairingRequests,
} from "../../pairing/pairing-store.js";
import { logVerbose } from "../../globals.js";
import {
  ErrorCodes,
  errorShape,
  validateChannelPairingApproveParams,
  validateChannelPairingClearParams,
  validateChannelPairingListParams,
} from "../protocol/index.js";
import { respondInvalidParams, respondUnavailableOnThrow } from "./nodes.helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const channelPairingHandlers: GatewayRequestHandlers = {
  "channel.pairing.list": async ({ params, respond }) => {
    if (!validateChannelPairingListParams(params)) {
      respondInvalidParams({
        respond,
        method: "channel.pairing.list",
        validator: validateChannelPairingListParams,
      });
      return;
    }
    const { channel } = params as { channel: string };
    await respondUnavailableOnThrow(respond, async () => {
      // Debug: log available pairing channels
      const availableChannels = listPairingChannels();
      logVerbose(
        `[channel.pairing.list] requested=${channel} availableChannels=[${availableChannels.join(", ")}]`,
      );

      // Validate channel supports pairing
      const resolvedChannel = resolvePairingChannel(channel);
      const requests = await listChannelPairingRequests(resolvedChannel);
      logVerbose(`[channel.pairing.list] channel=${resolvedChannel} requests=${requests.length}`);
      respond(
        true,
        {
          channel: resolvedChannel,
          requests: requests.map((r) => ({
            id: r.id,
            code: r.code,
            createdAt: r.createdAt,
            lastSeenAt: r.lastSeenAt,
            meta: r.meta,
          })),
        },
        undefined,
      );
    });
  },

  "channel.pairing.approve": async ({ params, respond }) => {
    if (!validateChannelPairingApproveParams(params)) {
      respondInvalidParams({
        respond,
        method: "channel.pairing.approve",
        validator: validateChannelPairingApproveParams,
      });
      return;
    }
    const { channel, code, notify } = params as {
      channel: string;
      code: string;
      notify?: boolean;
    };
    await respondUnavailableOnThrow(respond, async () => {
      // Validate channel supports pairing
      const resolvedChannel = resolvePairingChannel(channel);

      const result = await approveChannelPairingCode({
        channel: resolvedChannel,
        code,
      });

      if (!result) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `No pending pairing request found for code: ${code}`,
          ),
        );
        return;
      }

      // Optionally notify the requester
      if (notify) {
        const cfg = loadConfig();
        await notifyPairingApproved({
          channelId: resolvedChannel,
          id: result.id,
          cfg,
        }).catch(() => {
          // Ignore notification errors - approval succeeded
        });
      }

      respond(
        true,
        {
          ok: true,
          channel: resolvedChannel,
          id: result.id,
          entry: result.entry,
        },
        undefined,
      );
    });
  },

  "channel.pairing.clear": async ({ params, respond }) => {
    if (!validateChannelPairingClearParams(params)) {
      respondInvalidParams({
        respond,
        method: "channel.pairing.clear",
        validator: validateChannelPairingClearParams,
      });
      return;
    }
    const { channel } = params as { channel: string };
    await respondUnavailableOnThrow(respond, async () => {
      // Validate channel supports pairing
      const resolvedChannel = resolvePairingChannel(channel);

      const result = await clearChannelAllowFromStore({
        channel: resolvedChannel,
      });

      logVerbose(
        `[channel.pairing.clear] channel=${resolvedChannel} cleared=${result.cleared} previousCount=${result.previousCount}`,
      );

      respond(
        true,
        {
          ok: true,
          channel: resolvedChannel,
          cleared: result.cleared,
          previousCount: result.previousCount,
        },
        undefined,
      );
    });
  },
};
