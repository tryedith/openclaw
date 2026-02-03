import { Type } from "@sinclair/typebox";

import { NonEmptyString } from "./primitives.js";

/** Schema for channel.pairing.list params */
export const ChannelPairingListParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Schema for channel.pairing.approve params */
export const ChannelPairingApproveParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    code: NonEmptyString,
    notify: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Schema for channel.pairing.clear params (clears all approved users) */
export const ChannelPairingClearParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
  },
  { additionalProperties: false },
);
