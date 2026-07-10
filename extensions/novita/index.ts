// Novita plugin entrypoint registers its OpenClaw integration.
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "openclaw/plugin-sdk/provider-model-shared";
import { buildProviderToolCompatFamilyHooks } from "openclaw/plugin-sdk/provider-tools";
import { NOVITA_DEFAULT_MODEL_REF } from "./models.js";
import {
  buildNovitaApiKeyCatalog,
  buildNovitaProvider,
  buildStaticNovitaProvider,
  resolveNovitaDiscoveryApiKey,
} from "./provider-catalog.js";

const PROVIDER_ID = "novita";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "NovitaAI Provider",
  description: "Bundled NovitaAI provider plugin",
  provider: {
    label: "NovitaAI",
    docsPath: "/providers/novita",
    aliases: ["novita-ai", "novitaai"],
    envVars: ["NOVITA_API_KEY"],
    auth: [
      {
        methodId: "api-key",
        label: "NovitaAI API key",
        hint: "OpenAI-compatible NovitaAI endpoint",
        optionKey: "novitaApiKey",
        flagName: "--novita-api-key",
        envVar: "NOVITA_API_KEY",
        promptMessage: "Enter NovitaAI API key",
        defaultModel: NOVITA_DEFAULT_MODEL_REF,
        noteTitle: "NovitaAI",
        noteMessage: "Manage API keys at https://novita.ai/settings/key-management",
      },
    ],
    catalog: {
      run: buildNovitaApiKeyCatalog,
      staticRun: async () => ({ provider: buildStaticNovitaProvider() }),
    },
    augmentModelCatalog: async (ctx) => {
      const configured = readConfiguredProviderCatalogEntries({
        config: ctx.config,
        providerId: PROVIDER_ID,
      });
      const provider = await buildNovitaProvider({
        discoveryApiKey: resolveNovitaDiscoveryApiKey(ctx),
      });
      const entries = [...configured];
      const seen = new Set(entries.map((entry) => entry.id));
      for (const model of provider.models) {
        if (seen.has(model.id)) {
          continue;
        }
        seen.add(model.id);
        entries.push({
          provider: PROVIDER_ID,
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow,
          reasoning: model.reasoning,
          input: model.input,
        });
      }
      return entries;
    },
    ...buildProviderReplayFamilyHooks({
      family: "openai-compatible",
      dropReasoningFromHistory: false,
    }),
    ...buildProviderToolCompatFamilyHooks("openai"),
  },
});
