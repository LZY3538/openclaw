// Whatsapp plugin module implements message line behavior.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

export {
  formatInboundEnvelope,
  type EnvelopeFormatOptions,
} from "openclaw/plugin-sdk/channel-inbound";

type WhatsAppMessagePrefixConfig = OpenClawConfig;

function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase() || "main";
}

function resolveIdentityNamePrefix(
  cfg: WhatsAppMessagePrefixConfig,
  agentId: string,
): string | undefined {
  const normalizedAgentId = normalizeAgentId(agentId);
  const identityName = cfg.agents?.list
    ?.find((agent) => normalizeAgentId(agent.id ?? "") === normalizedAgentId)
    ?.identity?.name?.trim();
  return identityName ? `[${identityName}]` : undefined;
}

function getChannelConfig(
  cfg: WhatsAppMessagePrefixConfig,
  channel: string,
): Record<string, unknown> | undefined {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const value = channels?.[channel];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function resolveMessagePrefix(
  cfg: WhatsAppMessagePrefixConfig,
  agentId: string,
  opts?: {
    configured?: string;
    hasAllowFrom?: boolean;
    fallback?: string;
    channel?: string;
    accountId?: string;
  },
): string {
  // L1: Channel account level
  if (opts?.channel && opts?.accountId) {
    const channelCfg = getChannelConfig(cfg, opts.channel);
    const accounts = channelCfg?.accounts as Record<string, Record<string, unknown>> | undefined;
    const accountPrefix = accounts?.[opts.accountId]?.messagePrefix as string | undefined;
    if (accountPrefix !== undefined) {
      return accountPrefix;
    }
  }

  // L2: Channel level
  if (opts?.channel) {
    const channelCfg = getChannelConfig(cfg, opts.channel);
    const channelPrefix = channelCfg?.messagePrefix as string | undefined;
    if (channelPrefix !== undefined) {
      return channelPrefix;
    }
  }

  // L3: Caller option or global messages level
  const configured = opts?.configured ?? cfg.messages?.messagePrefix;
  if (configured !== undefined) {
    return configured;
  }

  // L4: hasAllowFrom → identity name prefix → fallback
  if (opts?.hasAllowFrom === true) {
    return "";
  }
  return resolveIdentityNamePrefix(cfg, agentId) ?? opts?.fallback ?? "[openclaw]";
}
