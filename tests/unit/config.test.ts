import { describe, expect, test } from "bun:test";
import { readConfig, ConfigError, legacyAliasNames } from "../../src/config/config";
import { redactConfig } from "../../src/config/redact";
import type { EnvSource } from "../../src/config/config";

function envOf(entries: Record<string, string>): EnvSource {
  return { get: (name) => entries[name] };
}

describe("config", () => {
  test("applies documented defaults", () => {
    const c = readConfig({ env: envOf({}), cwd: "/tmp", dev: false });
    expect(c.host).toBe("0.0.0.0");
    expect(c.port).toBe(8999);
    expect(c.poller.enabled).toBe(false);
    expect(c.poller.intervalSeconds).toBe(300);
    expect(c.privacy.showPrivateRepoItems).toBe(false);
    expect(c.auth.enabled).toBe(false);
    expect(c.orchestrator.lookbackDays).toBe(90);
    expect(c.usage.periodDays).toBe(90);
    expect(c.retention.snapshotsDays).toBe(30);
    expect(c.retention.dailyMetricsDays).toBe(90);
  });

  test("dev mode defaults to port 3000 and repo-local db dir", () => {
    const c = readConfig({ env: envOf({}), cwd: "/home/agent/x", dev: true });
    expect(c.port).toBe(3000);
    expect(c.db.dir).toBe("/home/agent/x/.data");
  });

  test("prod mode uses the V2-specific db dir (never the V1 path)", () => {
    const c = readConfig({ env: envOf({}), cwd: "/home/agent/x", dev: false });
    expect(c.db.dir).toContain("signal-house-v2");
    expect(c.db.dir).not.toContain("signal-house/runtime");
  });

  test("parses booleans from many accepted spellings", () => {
    const c = readConfig({
      env: envOf({
        SECRET_HOUSE_POLLER_ENABLED: "true",
        SECRET_HOUSE_RUN_ON_STARTUP: "1",
        SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS: "yes",
        SECRET_HOUSE_ACCESS_PASSWORD: "hunter2",
      }),
      cwd: "/tmp",
      dev: false,
    });
    expect(c.poller.enabled).toBe(true);
    expect(c.poller.runOnStartup).toBe(true);
    expect(c.privacy.showPrivateRepoItems).toBe(true);
    expect(c.auth.enabled).toBe(true);
  });

  test("clamps unsafe numeric values", () => {
    const c = readConfig({
      env: envOf({ SECRET_HOUSE_POLL_INTERVAL_SECONDS: "99999", SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH: "-5" }),
      cwd: "/tmp",
      dev: false,
    });
    expect(c.poller.intervalSeconds).toBe(3600);
    expect(c.git.maxDepth).toBe(0);
  });

  test("rejects malformed critical values", () => {
    expect(() =>
      readConfig({ env: envOf({ SECRET_HOUSE_POLL_INTERVAL_SECONDS: "abc" }), cwd: "/tmp", dev: false }),
    ).toThrow(ConfigError);
    expect(() => readConfig({ env: envOf({ SECRET_HOUSE_POLLER_ENABLED: "maybe" }), cwd: "/tmp", dev: false })).toThrow(
      ConfigError,
    );
  });

  test("expands home-directory paths", () => {
    const c = readConfig({ env: envOf({ SECRET_HOUSE_HERMES_DB_PATH: "~/custom/state.db" }), cwd: "/tmp", dev: false });
    expect(c.hermes.dbPath).toBe(`${process.env.HOME}/custom/state.db`);
  });

  test("expands SECRET_HOUSE_HERMES_PROFILES_DIR", () => {
    const c = readConfig({
      env: envOf({ SECRET_HOUSE_HERMES_PROFILES_DIR: "~/hermes-profiles" }),
      cwd: "/tmp",
      dev: false,
    });
    expect(c.hermes.profilesDir).toBe(`${process.env.HOME}/hermes-profiles`);
  });

  test("supports documented legacy aliases, preferred name wins", () => {
    expect(legacyAliasNames()).toContain("GITHUB_TOKEN");
    const viaLegacy = readConfig({
      env: envOf({ GITHUB_TOKEN: "legacy-token", GITHUB_OWNER: "legacy-owner" }),
      cwd: "/tmp",
      dev: false,
    });
    expect(viaLegacy.github.token).toBe("legacy-token");
    expect(viaLegacy.github.owner).toBe("legacy-owner");

    const preferred = readConfig({
      env: envOf({ GITHUB_TOKEN: "legacy", SECRET_HOUSE_GITHUB_TOKEN: "preferred" }),
      cwd: "/tmp",
      dev: false,
    });
    expect(preferred.github.token).toBe("preferred");
  });

  test("defaults hermes/opencode db paths to the real local sources", () => {
    const c = readConfig({ env: envOf({}), cwd: "/tmp", dev: false });
    expect(c.hermes.dbPath).toBe(`${process.env.HOME}/.hermes/state.db`);
    expect(c.hermes.profilesDir).toBe(`${process.env.HOME}/.hermes/profiles`);
    expect(c.opencode.dbPath).toBe(`${process.env.HOME}/.local/share/opencode/opencode.db`);
  });

  test("estimateCosts defaults to true (env-var unset)", () => {
    const c = readConfig({ env: envOf({}), cwd: "/tmp", dev: false });
    expect(c.estimateCosts).toBe(true);
  });

  test("estimateCosts parses SIGNAL_HOUSE_ESTIMATE_COSTS from many boolean spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      const c = readConfig({ env: envOf({ SIGNAL_HOUSE_ESTIMATE_COSTS: v }), cwd: "/tmp", dev: false });
      expect(c.estimateCosts).toBe(true);
    }
    for (const v of ["false", "FALSE", "0", "no", "off"]) {
      const c = readConfig({ env: envOf({ SIGNAL_HOUSE_ESTIMATE_COSTS: v }), cwd: "/tmp", dev: false });
      expect(c.estimateCosts).toBe(false);
    }
  });

  test("estimateCosts rejects malformed values with ConfigError", () => {
    expect(() =>
      readConfig({ env: envOf({ SIGNAL_HOUSE_ESTIMATE_COSTS: "maybe" }), cwd: "/tmp", dev: false }),
    ).toThrow(ConfigError);
  });

  test("hostMetrics defaults to disabled (env-var unset)", () => {
    const c = readConfig({ env: envOf({}), cwd: "/tmp", dev: false });
    expect(c.hostMetrics.enabled).toBe(false);
  });

  test("hostMetrics parses SIGNAL_HOUSE_HOST_METRICS_ENABLED boolean spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      const c = readConfig({ env: envOf({ SIGNAL_HOUSE_HOST_METRICS_ENABLED: v }), cwd: "/tmp", dev: false });
      expect(c.hostMetrics.enabled).toBe(true);
    }
    for (const v of ["false", "FALSE", "0", "no", "off"]) {
      const c = readConfig({ env: envOf({ SIGNAL_HOUSE_HOST_METRICS_ENABLED: v }), cwd: "/tmp", dev: false });
      expect(c.hostMetrics.enabled).toBe(false);
    }
  });

  test("hostMetrics rejects malformed values with ConfigError", () => {
    expect(() =>
      readConfig({ env: envOf({ SIGNAL_HOUSE_HOST_METRICS_ENABLED: "sure" }), cwd: "/tmp", dev: false }),
    ).toThrow(ConfigError);
  });

  test("orchestrator.githubIntervalSeconds defaults to 600 (10 min)", () => {
    const c = readConfig({ env: envOf({}), cwd: "/tmp", dev: false });
    expect(c.orchestrator.githubIntervalSeconds).toBe(600);
  });

  test("orchestrator.githubIntervalSeconds clamps into [60, 86400]", () => {
    expect(readConfig({ env: envOf({ SECRET_HOUSE_GITHUB_INTERVAL_SECONDS: "30" }), cwd: "/tmp", dev: false }).orchestrator.githubIntervalSeconds).toBe(60);
    expect(readConfig({ env: envOf({ SECRET_HOUSE_GITHUB_INTERVAL_SECONDS: "900" }), cwd: "/tmp", dev: false }).orchestrator.githubIntervalSeconds).toBe(900);
    expect(readConfig({ env: envOf({ SECRET_HOUSE_GITHUB_INTERVAL_SECONDS: "999999" }), cwd: "/tmp", dev: false }).orchestrator.githubIntervalSeconds).toBe(86_400);
  });

  test("orchestrator.githubIntervalSeconds rejects malformed values with ConfigError", () => {
    expect(() =>
      readConfig({ env: envOf({ SECRET_HOUSE_GITHUB_INTERVAL_SECONDS: "soon" }), cwd: "/tmp", dev: false }),
    ).toThrow(ConfigError);
  });
});

describe("config redaction", () => {
  test("never leaks secrets in the redacted summary", () => {
    const c = readConfig({
      env: envOf({
        SECRET_HOUSE_GITHUB_TOKEN: "ghp_supersecret",
        SECRET_HOUSE_ACCESS_PASSWORD: "password123",
      }),
      cwd: "/tmp",
      dev: false,
    });
    const redacted = JSON.stringify(redactConfig(c));
    expect(redacted).not.toContain("ghp_supersecret");
    expect(redacted).not.toContain("password123");
    expect(redacted).toContain("<set>");
  });
});
