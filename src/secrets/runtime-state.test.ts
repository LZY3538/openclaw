/** Tests secrets runtime state clone isolation and refresh context. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRuntimeAuthProfileStoreCredentialsRevision,
  getRuntimeAuthProfileStoreSnapshot,
  setRuntimeAuthProfileStoreSnapshot,
} from "../agents/auth-profiles/runtime-snapshots.js";
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
});
