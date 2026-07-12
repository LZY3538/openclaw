/** Tests secrets runtime state clone isolation and refresh context. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRuntimeAuthProfileStoreCredentialsRevision,
  getRuntimeAuthProfileStoreSnapshot,
  setRuntimeAuthProfileStoreSnapshot,
} from "../agents/auth-profiles/runtime-snapshots.js";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import { captureEnv } from "../test-utils/env.js";
import {
  activateSecretsRuntimeSnapshotState,
  activateSecretsRuntimeSnapshotStateIfCurrent,
  clearSecretsRuntimeSnapshot,
  getActiveSecretsRuntimeConfigSnapshot,
  getActiveSecretsRuntimeSnapshot,
  getActiveSecretsRuntimeSnapshotRevision,
  restoreSecretsRuntimeSnapshotStateIfCurrent,
  type PreparedSecretsRuntimeSnapshot,
} from "./runtime-state.js";

describe("secrets runtime state", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["OPENCLAW_STATE_DIR"]);
  });

  afterEach(() => {
    clearSecretsRuntimeSnapshot();
    envSnapshot.restore();
  });

  it("exposes the active config pair for hot paths without requiring the full snapshot", () => {
    const snapshot: PreparedSecretsRuntimeSnapshot = {
      sourceConfig: { agents: { list: [{ id: "source" }] } },
      config: { agents: { list: [{ id: "runtime" }] } },
      authStores: [],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    };

    activateSecretsRuntimeSnapshotState({
      snapshot,
      refreshContext: null,
      refreshHandler: null,
    });

    const configSnapshot = getActiveSecretsRuntimeConfigSnapshot();
    const fullSnapshot = getActiveSecretsRuntimeSnapshot();

    expect(configSnapshot?.config).not.toBe(fullSnapshot?.config);
    expect(configSnapshot?.sourceConfig).not.toBe(fullSnapshot?.sourceConfig);
    expect(configSnapshot?.config).toEqual(snapshot.config);
    expect(configSnapshot?.sourceConfig).toEqual(snapshot.sourceConfig);
  });

  it("preserves live auth bookkeeping when prepared credentials activate", () => {
    const agentDir = "/tmp/openclaw-auth-bookkeeping-merge";
    const credential = {
      type: "api_key" as const,
      provider: "openai",
      key: "sk-current",
    };
    setRuntimeAuthProfileStoreSnapshot(
      {
        version: 1,
        profiles: { "openai:default": credential },
        usageStats: { "openai:default": { lastUsed: 1 } },
      },
      agentDir,
    );
    const snapshot: PreparedSecretsRuntimeSnapshot = {
      sourceConfig: {},
      config: {},
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: { "openai:default": credential },
            usageStats: { "openai:default": { lastUsed: 1 } },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    };
    setRuntimeAuthProfileStoreSnapshot(
      {
        version: 1,
        profiles: { "openai:default": credential },
        usageStats: {
          "openai:default": { lastUsed: 2, cooldownUntil: Date.now() + 60_000 },
        },
      },
      agentDir,
    );

    activateSecretsRuntimeSnapshotState({
      snapshot,
      refreshContext: null,
      refreshHandler: null,
    });

    expect(
      getRuntimeAuthProfileStoreSnapshot(agentDir)?.usageStats?.["openai:default"],
    ).toMatchObject({ lastUsed: 2, cooldownUntil: expect.any(Number) });
  });

  it("removes candidate-only auth profiles when rolling config back", () => {
    const agentDir = "/tmp/openclaw-auth-rollback-cas";
    const snapshot = (key: string, port: number): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {},
      config: { gateway: { port } },
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key },
            },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot("sk-old", 19_001),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot();
    const previousRevision = getActiveSecretsRuntimeSnapshotRevision();
    const candidate = snapshot("sk-old", 19_002);
    candidate.authStores[0]!.store.profiles["anthropic:candidate"] = {
      type: "api_key",
      provider: "anthropic",
      key: "sk-rejected-candidate",
    };
    expect(previous).not.toBeNull();
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: previousRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const candidateRevision = getActiveSecretsRuntimeSnapshotRevision();
    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous!,
        expectedRevision: candidateRevision,
        ownedSnapshot: candidate,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    expect(getActiveSecretsRuntimeSnapshot()?.config.gateway?.port).toBe(19_001);
    expect(getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["openai:default"]).toMatchObject({
      key: "sk-old",
    });
    expect(
      getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["anthropic:candidate"],
    ).toBeUndefined();
  });

  it("rolls back candidate credentials against the activation-time auth baseline", () => {
    const agentDir = "/tmp/openclaw-auth-activation-baseline";
    const profile = (provider: string, key: string) => ({
      type: "api_key" as const,
      provider,
      key,
    });
    const snapshot = (
      profiles: AuthProfileStore["profiles"],
      port: number,
      state: Pick<AuthProfileStore, "order" | "lastGood" | "usageStats"> = {},
    ): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {},
      config: { gateway: { port } },
      authStores: [{ agentDir, store: { version: 1, profiles, ...state } }],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    const predecessorProfiles = {
      "provider-a:default": profile("provider-a", "a-old"),
      "provider-b:default": profile("provider-b", "b-old"),
    };
    const predecessorState = {
      order: { provider: ["provider-a:default", "provider-b:default"] },
      lastGood: { provider: "provider-a:default" },
      usageStats: { "provider-b:default": { lastUsed: 1 } },
    };
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot(predecessorProfiles, 19_001, predecessorState),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot()!;
    const previousRevision = getActiveSecretsRuntimeSnapshotRevision();
    const activationProfiles = {
      ...predecessorProfiles,
      "provider-b:default": profile("provider-b", "b-external"),
      "provider-q:login": profile("provider-q", "q-external"),
    };
    const activationState = {
      order: { provider: ["provider-b:default", "provider-a:default"] },
      lastGood: { provider: "provider-b:default" },
      usageStats: {
        "provider-b:default": { lastUsed: 2, cooldownUntil: 30_000 },
      },
    };
    setRuntimeAuthProfileStoreSnapshot(
      { version: 1, profiles: activationProfiles, ...activationState },
      agentDir,
    );
    const candidate = snapshot(
      {
        ...activationProfiles,
        "provider-a:default": profile("provider-a", "a-candidate"),
        "provider-x:candidate": profile("provider-x", "x-candidate"),
      },
      19_002,
      activationState,
    );
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: previousRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        ownedSnapshot: candidate,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const restored = getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles;
    expect(restored?.["provider-a:default"]).toMatchObject({ key: "a-old" });
    expect(restored?.["provider-b:default"]).toMatchObject({ key: "b-external" });
    expect(restored?.["provider-q:login"]).toMatchObject({ key: "q-external" });
    expect(restored?.["provider-x:candidate"]).toBeUndefined();
    const restoredStore = getRuntimeAuthProfileStoreSnapshot(agentDir);
    expect(restoredStore?.order?.provider).toEqual(["provider-b:default", "provider-a:default"]);
    expect(restoredStore?.lastGood?.provider).toBe("provider-b:default");
    expect(restoredStore?.usageStats?.["provider-b:default"]).toMatchObject({
      lastUsed: 2,
      cooldownUntil: 30_000,
    });
  });

  it.each([
    { label: "captured by the candidate", finalKey: "sk-candidate" },
    { label: "updated again after activation", finalKey: "sk-external" },
  ])("preserves an auth rotation $label", ({ finalKey }) => {
    const agentDir = `/tmp/openclaw-auth-rollback-${finalKey}`;
    const snapshot = (key: string, port: number): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {},
      config: { gateway: { port } },
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key },
            },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot("sk-old", 19_001),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot()!;
    const previousRevision = getActiveSecretsRuntimeSnapshotRevision();
    setRuntimeAuthProfileStoreSnapshot(
      snapshot("sk-candidate", 19_002).authStores[0]!.store,
      agentDir,
    );
    const candidate = snapshot("sk-candidate", 19_002);
    candidate.authStores[0]!.store.profiles["anthropic:candidate"] = {
      type: "api_key",
      provider: "anthropic",
      key: "sk-rejected-candidate",
    };
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: previousRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    if (finalKey !== "sk-candidate") {
      setRuntimeAuthProfileStoreSnapshot(snapshot(finalKey, 19_002).authStores[0]!.store, agentDir);
    }

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        ownedSnapshot: candidate,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    expect(getActiveSecretsRuntimeSnapshot()?.config.gateway?.port).toBe(19_001);
    expect(getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["openai:default"]).toMatchObject({
      key: finalKey,
    });
    expect(
      getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["anthropic:candidate"],
    ).toBeUndefined();
  });

  it.each([
    { label: "retains a resolved value for the same auth-store SecretRef", changedRef: false },
    { label: "restores the predecessor when the auth-store SecretRef changed", changedRef: true },
  ])("$label", ({ changedRef }) => {
    const agentDir = `/tmp/openclaw-auth-ref-rollback-${changedRef}`;
    const previousRef = {
      source: "env" as const,
      provider: "default",
      id: "OPENAI_API_KEY",
    };
    const candidateRef = changedRef ? { ...previousRef, id: "OPENAI_API_KEY_NEXT" } : previousRef;
    const snapshot = (
      key: string,
      keyRef: typeof previousRef,
      port: number,
    ): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {},
      config: { gateway: { port } },
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key, keyRef },
            },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot("sk-old", previousRef, 19_001),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot()!;
    const candidate = snapshot("sk-candidate", candidateRef, 19_002);
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const candidateRevision = getActiveSecretsRuntimeSnapshotRevision();
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: snapshot("sk-refreshed", candidateRef, 19_002),
        expectedRevision: candidateRevision,
        refreshContext: null,
        refreshHandler: null,
        preserveActivationLineage: true,
      }),
    ).toBe(true);

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous,
        expectedRevision: candidateRevision,
        ownedSnapshot: candidate,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    expect(getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["openai:default"]).toMatchObject({
      key: changedRef ? "sk-old" : "sk-refreshed",
      keyRef: changedRef ? previousRef : candidateRef,
    });
  });

  it("preserves live credentials when the captured predecessor is stale", () => {
    const agentDir = "/tmp/openclaw-auth-stale-predecessor-rollback";
    const snapshot = (key: string, port: number): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {},
      config: { gateway: { port } },
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "openai:default": { type: "api_key", provider: "openai", key },
            },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot("sk-old", 19_011),
      refreshContext: null,
      refreshHandler: null,
    });
    setRuntimeAuthProfileStoreSnapshot(
      {
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-live" },
        },
      },
      agentDir,
    );
    const previous = getActiveSecretsRuntimeSnapshot();
    const previousRevision = getActiveSecretsRuntimeSnapshotRevision();
    const candidate = snapshot("sk-live", 19_012);
    expect(previous).not.toBeNull();
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: previousRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous!,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        ownedSnapshot: candidate,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    expect(getActiveSecretsRuntimeSnapshot()?.config.gateway?.port).toBe(19_011);
    expect(getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["openai:default"]).toMatchObject({
      key: "sk-live",
    });
  });

  it.each([
    {
      label: "retains a provider-auth descendant for the same SecretRef",
      candidateRefId: "OPENAI_API_KEY",
      expectedKey: "sk-refreshed",
    },
    {
      label: "retains a provider-auth descendant for matching env shorthand",
      candidateRefId: "OPENAI_API_KEY",
      expectedKey: "sk-refreshed",
      shorthand: true,
    },
    {
      label: "restores the predecessor value when the candidate changed its SecretRef",
      candidateRefId: "OPENAI_API_KEY_NEXT",
      expectedKey: "sk-old",
    },
  ])("$label", ({ candidateRefId, expectedKey, shorthand }) => {
    const previousKeyRef = {
      source: "env" as const,
      provider: "default",
      id: "OPENAI_API_KEY",
    };
    const previousKeyInput = shorthand ? "$OPENAI_API_KEY" : previousKeyRef;
    const candidateKeyInput = shorthand
      ? `$${candidateRefId}`
      : { ...previousKeyRef, id: candidateRefId };
    const snapshot = (params: {
      sourcePort: number;
      runtimePort: number;
      apiKey: string;
      keyRef: string | typeof previousKeyRef;
    }): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {
        gateway: { port: params.sourcePort },
        models: { providers: { openai: { apiKey: params.keyRef, models: [] } } },
      },
      config: {
        gateway: { port: params.runtimePort },
        models: {
          providers: {
            openai: { apiKey: params.apiKey, models: [] },
          },
        },
      },
      authStores: [],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot({
        sourcePort: 19_021,
        runtimePort: 19_021,
        apiKey: "sk-old",
        keyRef: previousKeyInput,
      }),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot()!;
    const candidate = snapshot({
      sourcePort: 19_022,
      runtimePort: 19_022,
      apiKey: "sk-candidate",
      keyRef: candidateKeyInput,
    });
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const candidateRevision = getActiveSecretsRuntimeSnapshotRevision();
    const providerRefresh = snapshot({
      sourcePort: 19_022,
      runtimePort: 19_022,
      apiKey: "sk-refreshed",
      keyRef: candidateKeyInput,
    });
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: providerRefresh,
        expectedRevision: candidateRevision,
        refreshContext: null,
        refreshHandler: null,
        preserveActivationLineage: true,
      }),
    ).toBe(true);

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous,
        ownedSnapshot: candidate,
        expectedRevision: candidateRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    expect(getActiveSecretsRuntimeSnapshot()?.config.gateway?.port).toBe(19_021);
    expect(getActiveSecretsRuntimeSnapshot()?.config.models?.providers?.openai?.apiKey).toBe(
      expectedKey,
    );
  });

  it("restores resolved values when a same-ref provider definition was rejected", () => {
    const agentDir = "/tmp/openclaw-auth-provider-definition-rollback";
    const keyRef = { source: "file" as const, provider: "vault", id: "openai" };
    const snapshot = (params: {
      providerPath: string;
      apiKey: string;
      port: number;
    }): PreparedSecretsRuntimeSnapshot => ({
      sourceConfig: {
        secrets: {
          providers: { vault: { source: "file", path: params.providerPath } },
        },
        gateway: { port: params.port },
        models: { providers: { openai: { apiKey: keyRef, models: [] } } },
      },
      config: {
        secrets: {
          providers: { vault: { source: "file", path: params.providerPath } },
        },
        gateway: { port: params.port },
        models: { providers: { openai: { apiKey: params.apiKey, models: [] } } },
      },
      authStores: [
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "openai:default": {
                type: "api_key",
                provider: "openai",
                keyRef,
                key: params.apiKey,
              },
            },
          },
        },
      ],
      authStoreCredentialsRevision: getRuntimeAuthProfileStoreCredentialsRevision(),
      warnings: [],
      webTools: {
        search: { providerSource: "none", diagnostics: [] },
        fetch: { providerSource: "none", diagnostics: [] },
        diagnostics: [],
      },
    });
    activateSecretsRuntimeSnapshotState({
      snapshot: snapshot({ providerPath: "/tmp/old-secrets.json", apiKey: "sk-old", port: 19_031 }),
      refreshContext: null,
      refreshHandler: null,
    });
    const previous = getActiveSecretsRuntimeSnapshot()!;
    const candidate = snapshot({
      providerPath: "/tmp/rejected-secrets.json",
      apiKey: "sk-candidate",
      port: 19_032,
    });
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: candidate,
        expectedRevision: getActiveSecretsRuntimeSnapshotRevision(),
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const candidateRevision = getActiveSecretsRuntimeSnapshotRevision();
    expect(
      activateSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: snapshot({
          providerPath: "/tmp/rejected-secrets.json",
          apiKey: "sk-refreshed",
          port: 19_032,
        }),
        expectedRevision: candidateRevision,
        refreshContext: null,
        refreshHandler: null,
        preserveActivationLineage: true,
      }),
    ).toBe(true);

    expect(
      restoreSecretsRuntimeSnapshotStateIfCurrent({
        snapshot: previous,
        ownedSnapshot: candidate,
        expectedRevision: candidateRevision,
        refreshContext: null,
        refreshHandler: null,
      }),
    ).toBe(true);
    const restored = getActiveSecretsRuntimeSnapshot();
    expect(restored?.sourceConfig.secrets?.providers?.vault).toMatchObject({
      path: "/tmp/old-secrets.json",
    });
    expect(restored?.config.models?.providers?.openai?.apiKey).toBe("sk-old");
    expect(getRuntimeAuthProfileStoreSnapshot(agentDir)?.profiles["openai:default"]).toMatchObject({
      key: "sk-old",
      keyRef,
    });
  });
});
