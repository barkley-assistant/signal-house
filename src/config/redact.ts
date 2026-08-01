import type { RuntimeConfig } from "./types";

const SECRET_KEYS: ReadonlyArray<string> = [
  "token",
  "password",
  "secret",
  "apikey",
  "api_key",
  "access_key",
  "credential",
];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEYS.some((s) => k.includes(s));
}

/** Deep-redact any value whose key looks secret, for safe diagnostics output. */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "<redacted>" : redactValue(v);
    }
    return out;
  }
  return value;
}

/** Redact the user-facing env surface for diagnostics. */
export function redactEnv(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = isSecretKey(k) ? "<redacted>" : v;
  }
  return out;
}

/** Build a redacted config summary safe to log. */
export function redactConfig(c: RuntimeConfig): Record<string, unknown> {
  // The object below is constructed with secrets already replaced by "<set>"
  // markers; the shape itself contains no secret values.
  return {
    dev: c.dev,
    environment: c.environment,
    host: c.host,
    port: c.port,
    dbDir: c.db.dir,
    authEnabled: c.auth.enabled,
    authUsername: c.auth.enabled ? c.auth.username : null,
    hasPassword: c.auth.password !== "",
    githubToken: c.github.token ? "<set>" : null,
    githubOwner: c.github.owner,
    githubRepo: c.github.repo,
    gitRepos: c.git.repos.length,
    gitRoots: c.git.roots.length,
    hermesDbPath: c.hermes.dbPath,
    opencodeDbPath: c.opencode.dbPath,
    pollerEnabled: c.poller.enabled,
    pollIntervalSeconds: c.poller.intervalSeconds,
    pollStartupDelaySeconds: c.poller.startupDelaySeconds,
    runOnStartup: c.poller.runOnStartup,
    concurrency: c.orchestrator.concurrency,
    lookbackDays: c.orchestrator.lookbackDays,
    retention: c.retention,
    showPrivateRepoItems: c.privacy.showPrivateRepoItems,
  };
}
