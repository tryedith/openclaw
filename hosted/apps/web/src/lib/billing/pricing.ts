/**
 * Model Pricing Module
 *
 * Fetches current model pricing from OpenRouter's free API.
 * Caches pricing for 1 hour to avoid excessive API calls.
 */

export interface ModelPricing {
  input: number; // USD per 1M tokens
  output: number; // USD per 1M tokens
  cacheRead: number; // USD per 1M cached-read tokens
  cacheWrite: number; // USD per 1M cache-write tokens
}

// Cache for pricing data
let cachedPricing: Map<string, ModelPricing> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type SupportedProvider = "anthropic" | "openai" | "google";

const SUPPORTED_PROVIDERS = new Set<SupportedProvider>([
  "anthropic",
  "openai",
  "google",
]);

// Conservative fallback pricing when OpenRouter fetch fails.
const FALLBACK_PRICING: Record<SupportedProvider | "default", ModelPricing> = {
  anthropic: { input: 3.0, output: 15.0, cacheRead: 3.0, cacheWrite: 3.0 },
  openai: { input: 10.0, output: 30.0, cacheRead: 10.0, cacheWrite: 10.0 },
  google: { input: 3.0, output: 15.0, cacheRead: 3.0, cacheWrite: 3.0 },
  default: { input: 10.0, output: 30.0, cacheRead: 10.0, cacheWrite: 10.0 },
};

function normalizePricingKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "");
}

function normalizeProvider(raw?: string): SupportedProvider | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized as SupportedProvider)) return null;
  return normalized as SupportedProvider;
}

function parseModelRef(raw: string): { provider: SupportedProvider; model: string } | null {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const provider = normalizeProvider(trimmed.slice(0, slash));
  if (!provider) return null;
  const model = trimmed.slice(slash + 1).trim();
  if (!model) return null;
  return { provider, model };
}

function inferProviderFromModel(modelId: string): SupportedProvider {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("claude-")) return "anthropic";
  if (normalized.startsWith("gpt-") || normalized.startsWith("o1")) return "openai";
  if (normalized.startsWith("gemini-")) return "google";
  return "anthropic";
}

function registerPricingAliases(
  pricing: Map<string, ModelPricing>,
  modelRef: string,
  value: ModelPricing
): void {
  const parsed = parseModelRef(modelRef);
  if (!parsed) return;

  const stripped = stripDateSuffix(parsed.model);
  pricing.set(normalizePricingKey(`${parsed.provider}/${parsed.model}`), value);
  pricing.set(normalizePricingKey(`${parsed.provider}/${stripped}`), value);
  // Compatibility aliases for legacy rows that only stored model id.
  pricing.set(normalizePricingKey(parsed.model), value);
  pricing.set(normalizePricingKey(stripped), value);
}

function buildLookupKeys(modelRefOrId: string): string[] {
  const trimmed = modelRefOrId.trim();
  if (!trimmed) return [];

  const parsed = parseModelRef(trimmed);
  const candidates = new Set<string>();

  if (parsed) {
    candidates.add(`${parsed.provider}/${parsed.model}`);
    candidates.add(`${parsed.provider}/${stripDateSuffix(parsed.model)}`);
    candidates.add(parsed.model);
    candidates.add(stripDateSuffix(parsed.model));
  } else {
    const inferred = inferProviderFromModel(trimmed);
    candidates.add(`${inferred}/${trimmed}`);
    candidates.add(`${inferred}/${stripDateSuffix(trimmed)}`);
    candidates.add(trimmed);
    candidates.add(stripDateSuffix(trimmed));
  }

  return [...candidates].map(normalizePricingKey);
}

/**
 * Fetch current pricing from OpenRouter API
 * Returns a map of normalized lookup keys -> pricing.
 */
async function fetchPricingFromOpenRouter(): Promise<Map<string, ModelPricing>> {
  const pricing = new Map<string, ModelPricing>();

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Accept: "application/json",
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`OpenRouter API returned ${response.status}`);
      return pricing;
    }

    const data = (await response.json()) as {
      data?: Array<{
        id?: string;
        canonical_slug?: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };

    if (!data.data || !Array.isArray(data.data)) {
      console.warn("Unexpected OpenRouter response format");
      return pricing;
    }

    for (const model of data.data) {
      if (!model.id || !model.pricing?.prompt || !model.pricing?.completion) {
        continue;
      }
      if (!parseModelRef(model.id)) continue;

      // OpenRouter returns price-per-token strings. Convert to per-million-token prices.
      const inputPricePerToken = parseFloat(model.pricing.prompt);
      const outputPricePerToken = parseFloat(model.pricing.completion);

      if (!Number.isFinite(inputPricePerToken) || !Number.isFinite(outputPricePerToken)) {
        continue;
      }

      const modelPricing = {
        input: inputPricePerToken * 1_000_000,
        output: outputPricePerToken * 1_000_000,
        cacheRead: inputPricePerToken * 1_000_000,
        cacheWrite: inputPricePerToken * 1_000_000,
      };

      registerPricingAliases(pricing, model.id, modelPricing);
      if (model.canonical_slug && model.canonical_slug !== model.id) {
        registerPricingAliases(pricing, model.canonical_slug, modelPricing);
      }
    }
  } catch (error) {
    console.error("Failed to fetch pricing from OpenRouter:", error);
  }

  return pricing;
}

/**
 * Get current model pricing (cached)
 * Returns a map of normalized lookup keys -> pricing.
 */
export async function getCurrentPricing(): Promise<Map<string, ModelPricing>> {
  const now = Date.now();

  // Return cached pricing if still valid
  if (cachedPricing && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPricing;
  }

  // Fetch fresh pricing
  const freshPricing = await fetchPricingFromOpenRouter();

  // Only update cache if we got some results
  if (freshPricing.size > 0) {
    cachedPricing = freshPricing;
    cacheTimestamp = now;
    console.log(`Cached ${freshPricing.size} model prices from OpenRouter`);
  } else if (cachedPricing) {
    // Keep using old cache if fetch failed
    console.warn("Using stale pricing cache (OpenRouter fetch failed)");
    return cachedPricing;
  }

  return cachedPricing ?? new Map();
}

/**
 * Get pricing for a specific model
 * Falls back to default pricing if model not found
 */
export async function getPricingForModel(modelRefOrId: string): Promise<ModelPricing> {
  const pricing = await getCurrentPricing();

  for (const key of buildLookupKeys(modelRefOrId)) {
    const match = pricing.get(key);
    if (match) return match;
  }

  const normalizedRequested = normalizePricingKey(modelRefOrId);
  for (const [key, value] of pricing) {
    if (
      normalizedRequested.includes(key) ||
      key.includes(normalizedRequested.split("-").slice(0, 2).join("-"))
    ) {
      return value;
    }
  }

  const parsed = parseModelRef(modelRefOrId);
  const provider = parsed?.provider ?? inferProviderFromModel(modelRefOrId);
  const providerFallback = FALLBACK_PRICING[provider];
  if (providerFallback) {
    console.warn(`No pricing found for model ${modelRefOrId}; using ${provider} fallback`);
    return providerFallback;
  }
  console.warn(`No pricing found for model ${modelRefOrId}; using default fallback`);
  return FALLBACK_PRICING.default;
}

/**
 * Calculate cost for a request
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): number {
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Clear the pricing cache (useful for testing)
 */
export function clearPricingCache(): void {
  cachedPricing = null;
  cacheTimestamp = 0;
}
