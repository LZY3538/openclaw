/** Parses AZURE_OPENAI_DEPLOYMENT_MAP-style model=deployment entries. */
export function parseAzureDeploymentNameMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) {
    return map;
  }
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const modelId = trimmed.slice(0, separator).trim();
    const deploymentName = trimmed.slice(separator + 1).trim();
    if (!modelId || !deploymentName) {
      continue;
    }
    map.set(modelId, deploymentName);
  }
  return map;
}

// Azure deployment maps come from a stable env var, so the resolver runs on hot paths
// (streams, lifecycle hooks) with the same string every call. Cache the parsed lookup map
// per raw string to avoid re-parsing, with a small bound so memory stays flat even if a
// caller ever varies the input.
const MAX_CACHED_DEPLOYMENT_MAPS = 32;
const deploymentNameMapCache = new Map<string, Map<string, string>>();

/** Returns a cached, lowercased-key lookup map for a deployment-map string. */
function getCachedDeploymentNameMap(deploymentMap: string | undefined): Map<string, string> {
  const cacheKey = deploymentMap ?? "";
  const cached = deploymentNameMapCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  // Normalize keys to lowercase so lookups are case-insensitive; deployment names
  // (the values) stay verbatim because Azure requires the exact deployment name.
  const normalized = new Map<string, string>();
  for (const [modelId, deploymentName] of parseAzureDeploymentNameMap(deploymentMap)) {
    normalized.set(modelId.toLowerCase(), deploymentName);
  }
  if (deploymentNameMapCache.size >= MAX_CACHED_DEPLOYMENT_MAPS) {
    const oldest = deploymentNameMapCache.keys().next().value;
    if (oldest !== undefined) {
      deploymentNameMapCache.delete(oldest);
    }
  }
  deploymentNameMapCache.set(cacheKey, normalized);
  return normalized;
}

/** Resolves the Azure deployment name for a model id, falling back to the model id. */
export function resolveAzureDeploymentNameFromMap(params: {
  modelId: string;
  deploymentMap?: string;
}): string {
  return (
    getCachedDeploymentNameMap(params.deploymentMap).get(params.modelId.toLowerCase()) ||
    params.modelId
  );
}

export const testing = {
  getCachedDeploymentNameMap,
  resetDeploymentNameMapCache: (): void => {
    deploymentNameMapCache.clear();
  },
};
