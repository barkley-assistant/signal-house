/**
 * Typed runtime configuration — the single place environment is read.
 *
 * Rules honoured here (instruction §Environment and Configuration):
 * - Read environment values exactly once, apply defaults centrally.
 * - Expand home-directory paths.
 * - Clamp unsafe numeric values into documented ranges.
 * - Reject *malformed* critical configuration (a present value that cannot
 *   parse) but treat a *missing* optional value as its default.
 * - Support documented legacy aliases, preferred SECRET_HOUSE_* wins.
 * - Redact secret values before any diagnostics output (see redact.ts).
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import type { RuntimeConfig } from "./types";

export { redactEnv, redactConfig } from "./redact";

export interface EnvSource {
  get(name: string): string | undefined;
}

/** Swappable env for tests. */
export const envReader: EnvSource = {
  get: (name) => process.env[name],
};

const LEGACY_ALIASES: Record<string, string> = {
  GITHUB_TOKEN: "SECRET_HOUSE_GITHUB_TOKEN",
  GITHUB_OWNER: "SECRET_HOUSE_GITHUB_OWNER",
  GITHUB_REPO: "SECRET_HOUSE_GITHUB_REPO",
  GIT_REPOS: "SECRET_HOUSE_GIT_REPOS",
  GIT_REPO_ROOTS: "SECRET_HOUSE_PROJECT_ROOTS",
  GIT_REPO_GLOBS: "SECRET_HOUSE_GIT_REPO_GLOBS",
  GIT_REPO_MAX_DEPTH: "SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH",
  GIT_REPO_EXCLUDES: "SECRET_HOUSE_GIT_EXCLUDE",
  SESSIONS_PERIOD_DAYS: "SECRET_HOUSE_SESSIONS_PERIOD_DAYS",
  METRICS_POLLER_ENABLED: "SECRET_HOUSE_POLLER_ENABLED",
  METRICS_POLL_INTERVAL_SECONDS: "SECRET_HOUSE_POLL_INTERVAL_SECONDS",
  METRICS_POLL_STARTUP_DELAY_SECONDS: "SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS",
  METRICS_RUN_ON_STARTUP: "SECRET_HOUSE_RUN_ON_STARTUP",
};

/** The documented legacy-alias map, exported for tests and .env.example. */
export function legacyAliasNames(): string[] {
  return Object.keys(LEGACY_ALIASES);
}

/** Reverse map: preferred name → legacy alias (for resolution). */
const LEGACY_BY_PREFERRED: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_ALIASES).map(([legacy, preferred]) => [preferred, legacy]),
);

interface Parsers {
  bool(name: string, def: boolean): boolean;
  int(name: string, def: number, min: number, max: number): number;
  str(name: string): string | undefined;
  strList(name: string): string[];
  path(name: string): string | null; // expands ~ ; null when unset/empty
}

export interface ConfigOptions {
  env: EnvSource;
  cwd: string;
  /** true when running from the dev wrapper (SIGNAL_HOUSE_DEV=1). */
  dev: boolean;
}

/** Thrown when a present-but-malformed critical env value is encountered. */
export class ConfigError extends Error {}

export function readConfig(options: ConfigOptions): RuntimeConfig {
  const { env, cwd, dev } = options;

  // Resolve a value, preferring SECRET_HOUSE_* and falling back to a documented
  // legacy alias (only the documented aliases in LEGACY_ALIASES are honoured).
  function effective(name: string): string | undefined {
    const direct = env.get(name);
    if (direct !== undefined) return direct;
    const legacy = LEGACY_BY_PREFERRED[name];
    return legacy ? env.get(legacy) : undefined;
  }

  const p: Parsers = {
    bool(name, def) {
      const v = env.get(name);
      if (v === undefined || v === "") return def;
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "yes" || t === "on") return true;
      if (t === "false" || t === "0" || t === "no" || t === "off") return false;
      throw new ConfigError(`${name} must be a boolean, got "${v}"`);
    },
    int(name, def, min, max) {
      const v = env.get(name);
      if (v === undefined || v === "") return def;
      if (!/^-?\d+$/.test(v.trim())) {
        throw new ConfigError(`${name} must be an integer, got "${v}"`);
      }
      const n = Number.parseInt(v.trim(), 10);
      if (Number.isNaN(n)) throw new ConfigError(`${name} must be an integer, got "${v}"`);
      return Math.min(max, Math.max(min, n));
    },
    str(name) {
      const v = env.get(name);
      return v === undefined || v === "" ? undefined : v;
    },
    strList(name) {
      const v = env.get(name);
      if (v === undefined || v === "") return [];
      return v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.startsWith("~") ? s.replace(/^~/, homedir()) : s));
    },
    path(name) {
      const v = effective(name);
      if (v === undefined || v === "") return null;
      const expanded = v.startsWith("~") ? v.replace(/^~/, homedir()) : v;
      return expanded;
    },
  };

  const accessUsername = effective("SECRET_HOUSE_ACCESS_USERNAME") ?? "signal-house";
  const accessPassword = effective("SECRET_HOUSE_ACCESS_PASSWORD") ?? "";

  // DB dir: dev defaults to <repo>/.data; production to a V2-specific path.
  // V2 is a fresh start (no migration) and deliberately does not share the V1
  // database location, so the old V1 file is never opened or touched.
  const dbDirFromEnv = env.get("DB_DIR");
  const dbDir =
    dbDirFromEnv !== undefined && dbDirFromEnv !== ""
      ? expandHome(dbDirFromEnv, cwd)
      : dev
        ? resolve(cwd, ".data")
        : resolve(homedir(), ".local/share/signal-house-v2/runtime/.data");

  const portEnv = env.get("PORT");
  const port =
    portEnv !== undefined && portEnv !== ""
      ? parsePort(portEnv)
      : dev
        ? 3000
        : 8999;

  const isDev = env.get("SIGNAL_HOUSE_DEV") === "1" || env.get("BUN_DEV") === "1";

  return {
    dev: isDev,
    environment: dev ? "development" : "production",
    host: env.get("HOST") ?? "0.0.0.0",
    port,
    db: {
      dir: dbDir,
      file: "metrics.db",
      path: resolve(dbDir, "metrics.db"),
    },
    auth: {
      username: accessUsername,
      password: accessPassword,
      enabled: accessPassword.length > 0,
    },
    github: {
      token: effective("SECRET_HOUSE_GITHUB_TOKEN") || null,
      owner: effective("SECRET_HOUSE_GITHUB_OWNER") || null,
      repo: effective("SECRET_HOUSE_GITHUB_REPO") || null,
    },
    git: {
      repos: p.strList("SECRET_HOUSE_GIT_REPOS"),
      roots: p.strList("SECRET_HOUSE_PROJECT_ROOTS"),
      globs: (effective("SECRET_HOUSE_GIT_REPO_GLOBS") || "*")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      maxDepth: p.int("SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH", 3, 0, 20),
      excludes: (effective("SECRET_HOUSE_GIT_EXCLUDE") ||
        "node_modules,dist,.next,.nuxt,.output,.git")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    },
    hermes: {
      dbPath: p.path("SECRET_HOUSE_HERMES_DB_PATH") ?? resolve(homedir(), ".hermes/state.db"),
    },
    opencode: {
      dbPath: p.path("SECRET_HOUSE_OPENCODE_DB_PATH") ?? resolve(homedir(), ".local/share/opencode/opencode.db"),
    },
    usage: {
      periodDays: p.int("SECRET_HOUSE_SESSIONS_PERIOD_DAYS", 30, 1, 3650),
    },
    poller: {
      enabled: p.bool("SECRET_HOUSE_POLLER_ENABLED", false),
      intervalSeconds: p.int("SECRET_HOUSE_POLL_INTERVAL_SECONDS", 300, 15, 3600),
      startupDelaySeconds: p.int("SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS", 5, 0, 3600),
      runOnStartup: p.bool("SECRET_HOUSE_RUN_ON_STARTUP", true),
    },
    orchestrator: {
      concurrency: p.int("SECRET_HOUSE_COLLECT_CONCURRENCY", 3, 1, 16),
      lookbackDays: p.int("SECRET_HOUSE_COLLECT_LOOKBACK_DAYS", 28, 1, 365),
    },
    staleness: {
      staleThresholdDays: p.int("SECRET_HOUSE_STALE_THRESHOLD_DAYS", 14, 1, 365),
      staleThresholdMinutes: p.int("SECRET_HOUSE_STALE_THRESHOLD_MINUTES", 15, 1, 1440),
    },
    retention: {
      snapshotsDays: p.int("SECRET_HOUSE_RETENTION_SNAPSHOTS_DAYS", 30, 1, 3650),
      dailyMetricsDays: p.int("SECRET_HOUSE_RETENTION_DAILY_METRICS_DAYS", 90, 7, 3650),
    },
    privacy: {
      showPrivateRepoItems: p.bool("SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS", false),
    },
    refresh: {
      lockStaleMs: p.int("SECRET_HOUSE_REFRESH_LOCK_STALE_MS", 600_000, 30_000, 3_600_000),
    },
  };
}

function expandHome(p: string, cwd: string): string {
  const expanded = p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
  return resolve(expanded.startsWith("/") ? expanded : resolve(cwd, expanded));
}

function parsePort(v: string): number {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) throw new ConfigError(`PORT must be a valid port, got "${v}"`);
  return n;
}
