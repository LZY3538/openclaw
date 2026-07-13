// Subagent registry SQLite store tests cover whole-snapshot persistence and
// one-time import from the legacy JSON registry file.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  loadSubagentRegistryFromSqlite,
  loadSubagentRunsForControllerFromSqlite,
  saveSubagentRegistryToSqlite,
} from "./subagent-registry.store.sqlite.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

function createRun(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "run-one",
    childSessionKey: "agent:main:subagent:one",
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "check sqlite persistence",
    cleanup: "keep",
    createdAt: 100,
    startedAt: 110,
    endedAt: 250,
    outcome: { status: "ok", startedAt: 110, endedAt: 250, elapsedMs: 140 },
    expectsCompletionMessage: true,
    completion: {
      required: true,
      resultText: "done",
      capturedAt: 260,
    },
    delivery: {
      status: "pending",
      createdAt: 270,
      lastAttemptAt: 280,
      attemptCount: 2,
      lastError: "retry later",
      payload: {
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        childSessionKey: "agent:main:subagent:one",
        childRunId: "run-one",
        task: "check sqlite persistence",
        startedAt: 110,
        endedAt: 250,
        outcome: { status: "ok" },
        expectsCompletionMessage: true,
      },
    },
    ...overrides,
  };
}

describe("subagent registry sqlite store", () => {
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-sqlite-"));
  });

  afterEach(async () => {
    closeOpenClawStateDatabaseForTest();
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      tempStateDir = null;
    }
  });

  async function withTempStateEnv<T>(fn: () => Promise<T>): Promise<T> {
    if (!tempStateDir) {
      throw new Error("expected temp state dir");
    }
    return await withEnvAsync({ OPENCLAW_STATE_DIR: tempStateDir }, fn);
  }

  it("persists subagent runs in the shared sqlite state database", async () => {
    await withTempStateEnv(async () => {
      const run = createRun({
        endedReason: "subagent-error",
        outcome: { status: "error", error: "restart interrupted run", endedAt: 250 },
        terminalOwner: "interrupted-recovery",
        completion: { required: true, resultText: null, capturedAt: 250 },
      });

      saveSubagentRegistryToSqlite(new Map([[run.runId, run]]));

      const restored = loadSubagentRegistryFromSqlite();
      expect(restored.get(run.runId)).toMatchObject({
        runId: run.runId,
        childSessionKey: run.childSessionKey,
        requesterSessionKey: run.requesterSessionKey,
        task: run.task,
        endedAt: run.endedAt,
        outcome: run.outcome,
        terminalOwner: "interrupted-recovery",
        completion: run.completion,
        delivery: run.delivery,
      });
      expect(await fs.stat(path.join(tempStateDir!, "state", "openclaw.sqlite"))).toBeTruthy();
      await expect(fs.stat(path.join(tempStateDir!, "subagents", "runs.json"))).rejects.toThrow();
    });
  });

  it("uses save calls as whole-registry snapshots", async () => {
    await withTempStateEnv(async () => {
      const first = createRun({ runId: "run-one", childSessionKey: "agent:main:subagent:one" });
      const second = createRun({ runId: "run-two", childSessionKey: "agent:main:subagent:two" });

      saveSubagentRegistryToSqlite(
        new Map([
          [first.runId, first],
          [second.runId, second],
        ]),
      );
      saveSubagentRegistryToSqlite(new Map([[second.runId, second]]));

      expect([...loadSubagentRegistryFromSqlite().keys()]).toEqual(["run-two"]);
    });
  });

  it("scoped controller query returns rows with matching controller_session_key", async () => {
    await withTempStateEnv(async () => {
      const direct = createRun({
        runId: "run-direct",
        childSessionKey: "agent:main:subagent:direct",
        controllerSessionKey: "agent:main:ctrl",
        requesterSessionKey: "agent:main:different",
      });
      const other = createRun({
        runId: "run-other2",
        childSessionKey: "agent:main:subagent:other2",
        controllerSessionKey: "agent:main:other-ctrl",
        requesterSessionKey: "agent:main:different",
      });

      saveSubagentRegistryToSqlite(
        new Map([
          [direct.runId, direct],
          [other.runId, other],
        ]),
      );

      const result = loadSubagentRunsForControllerFromSqlite("agent:main:ctrl");
      expect(result.map((r) => r.runId).toSorted()).toEqual(["run-direct"]);
    });
  });

  it("scoped controller query falls back to requester_session_key when controller is null", async () => {
    await withTempStateEnv(async () => {
      const noController = createRun({
        runId: "run-no-ctrl",
        childSessionKey: "agent:main:subagent:noc",
        controllerSessionKey: undefined,
        requesterSessionKey: "agent:main:target",
      });
      const withController = createRun({
        runId: "run-with-ctrl",
        childSessionKey: "agent:main:subagent:withc",
        controllerSessionKey: "agent:main:other",
        requesterSessionKey: "agent:main:target",
      });

      saveSubagentRegistryToSqlite(
        new Map([
          [noController.runId, noController],
          [withController.runId, withController],
        ]),
      );

      const result = loadSubagentRunsForControllerFromSqlite("agent:main:target");
      expect(result.map((r) => r.runId).toSorted()).toEqual(["run-no-ctrl"]);
    });
  });

  it("scoped controller query combines explicit controller and null-controller requester fallback", async () => {
    await withTempStateEnv(async () => {
      const explicitCtrl = createRun({
        runId: "run-explicit",
        childSessionKey: "agent:main:subagent:explicit",
        controllerSessionKey: "agent:main:ctrl",
        requesterSessionKey: "agent:main:other",
      });
      const nullCtrl = createRun({
        runId: "run-null",
        childSessionKey: "agent:main:subagent:null",
        controllerSessionKey: undefined,
        requesterSessionKey: "agent:main:ctrl",
      });
      const noMatch = createRun({
        runId: "run-nope",
        childSessionKey: "agent:main:subagent:nope",
        controllerSessionKey: "agent:main:third",
        requesterSessionKey: "agent:main:fourth",
      });

      saveSubagentRegistryToSqlite(
        new Map([
          [explicitCtrl.runId, explicitCtrl],
          [nullCtrl.runId, nullCtrl],
          [noMatch.runId, noMatch],
        ]),
      );

      const result = loadSubagentRunsForControllerFromSqlite("agent:main:ctrl");
      expect(result.map((r) => r.runId).toSorted()).toEqual(["run-explicit", "run-null"]);
    });
  });

  it("imports the legacy json registry when sqlite has no runs", async () => {
    await withTempStateEnv(async () => {
      // Import deletes the JSON source after the first successful migration so
      // later loads treat SQLite as canonical state.
      const legacyRun = createRun({
        runId: "legacy-run",
        childSessionKey: "agent:main:subagent:legacy",
        task: "import legacy registry",
      });
      const registryPath = path.join(tempStateDir!, "subagents", "runs.json");
      await fs.mkdir(path.dirname(registryPath), { recursive: true });
      await fs.writeFile(
        registryPath,
        `${JSON.stringify({ version: 2, runs: { [legacyRun.runId]: legacyRun } })}\n`,
        "utf8",
      );

      const imported = loadSubagentRegistryFromSqlite();

      expect(imported.get(legacyRun.runId)?.task).toBe("import legacy registry");
      await expect(fs.stat(registryPath)).rejects.toThrow();
      expect(loadSubagentRegistryFromSqlite().get(legacyRun.runId)?.task).toBe(
        "import legacy registry",
      );
      expect(
        openOpenClawStateDatabase().db.prepare("SELECT COUNT(*) AS count FROM subagent_runs").get(),
      ).toEqual({ count: 1 });
    });
  });
});
