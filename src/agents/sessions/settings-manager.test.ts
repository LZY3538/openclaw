/** Tests session settings manager runtime overrides. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsManager } from "./settings-manager.js";

describe("SettingsManager runtime overrides", () => {
  it("preserves compaction overrides after global setting writes", async () => {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    });

    settingsManager.applyOverrides({
      compaction: { reserveTokens: 50_000, keepRecentTokens: 16_000 },
    });
    settingsManager.setCompactionEnabled(false);

    expect(settingsManager.getCompactionSettings()).toEqual({
      enabled: false,
      reserveTokens: 50_000,
      keepRecentTokens: 16_000,
    });

    await settingsManager.flush();
    await settingsManager.reload();

    expect(settingsManager.getCompactionSettings()).toEqual({
      enabled: false,
      reserveTokens: 50_000,
      keepRecentTokens: 16_000,
    });
  });

  it("preserves runtime overrides after project setting writes", async () => {
    const settingsManager = SettingsManager.inMemory({
      compaction: { reserveTokens: 16_384 },
    });

    settingsManager.applyOverrides({ compaction: { reserveTokens: 50_000 } });
    settingsManager.setProjectPackages(["npm:@openclaw/example"]);

    expect(settingsManager.getPackages()).toEqual(["npm:@openclaw/example"]);
    expect(settingsManager.getCompactionReserveTokens()).toBe(50_000);

    await settingsManager.flush();
    await settingsManager.reload();

    expect(settingsManager.getPackages()).toEqual(["npm:@openclaw/example"]);
    expect(settingsManager.getCompactionReserveTokens()).toBe(50_000);
  });
});

describe("SettingsManager nested settings merge", () => {
  it("merges nested retry.provider fields set in global and project scopes", () => {
    const root = mkdtempSync(join(tmpdir(), "settings-scope-merge-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(cwd, ".openclaw"), { recursive: true });
    // Global scope sets two provider fields; project scope sets only a third.
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ retry: { provider: { timeoutMs: 30_000, maxRetries: 5 } } }),
    );
    writeFileSync(
      join(cwd, ".openclaw", "settings.json"),
      JSON.stringify({ retry: { provider: { maxRetryDelayMs: 5_000 } } }),
    );

    try {
      const settingsManager = SettingsManager.create(cwd, agentDir);

      // The project scope's partial provider object must not erase the global
      // provider siblings; all three fields survive field-by-field.
      expect(settingsManager.getProviderRetrySettings()).toEqual({
        timeoutMs: 30_000,
        maxRetries: 5,
        maxRetryDelayMs: 5_000,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges nested retry.provider fields from runtime overrides onto base scope", () => {
    const settingsManager = SettingsManager.inMemory({
      retry: { provider: { timeoutMs: 30_000, maxRetries: 5 } },
    });

    settingsManager.applyOverrides({ retry: { provider: { maxRetryDelayMs: 5_000 } } });

    expect(settingsManager.getProviderRetrySettings()).toEqual({
      timeoutMs: 30_000,
      maxRetries: 5,
      maxRetryDelayMs: 5_000,
    });
  });

  it("keeps override-wins semantics for overlapping nested fields", () => {
    const settingsManager = SettingsManager.inMemory({
      retry: { provider: { timeoutMs: 30_000, maxRetries: 5 } },
    });

    settingsManager.applyOverrides({ retry: { provider: { maxRetries: 9 } } });

    expect(settingsManager.getProviderRetrySettings()).toEqual({
      timeoutMs: 30_000,
      maxRetries: 9,
      maxRetryDelayMs: 60_000,
    });
  });
});
