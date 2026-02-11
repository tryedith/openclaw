type ResolveGatewayTargetParams = {
  instancePublicUrl: string;
  instanceToken: string;
  instanceId?: string;
};

function normalizeGatewayUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

export function resolveGatewayTarget(params: ResolveGatewayTargetParams): {
  gatewayUrl: string;
  token: string;
  overridden: boolean;
} {
  const defaultGatewayUrl = normalizeGatewayUrl(params.instancePublicUrl);
  const defaultToken = params.instanceToken;

  const localGatewayUrlRaw = process.env.LOCAL_GATEWAY_URL?.trim();
  if (!localGatewayUrlRaw) {
    return { gatewayUrl: defaultGatewayUrl, token: defaultToken, overridden: false };
  }

  const localGatewayInstanceId = process.env.LOCAL_GATEWAY_INSTANCE_ID?.trim();
  if (localGatewayInstanceId && params.instanceId && params.instanceId !== localGatewayInstanceId) {
    return { gatewayUrl: defaultGatewayUrl, token: defaultToken, overridden: false };
  }

  const localGatewayUrl = normalizeGatewayUrl(localGatewayUrlRaw);
  const localGatewayToken = process.env.LOCAL_GATEWAY_TOKEN?.trim();

  return {
    gatewayUrl: localGatewayUrl,
    token: localGatewayToken || defaultToken,
    overridden: true,
  };
}
