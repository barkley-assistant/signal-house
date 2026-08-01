/**
 * Minimal structured logger.
 *
 * Never logs secrets — values are only ever passed through `redactValue`
 * (see config/redact.ts), and the full env is never dumped. Log lines go to
 * stdout/stderr (journald in production, the dev wrapper tees stdout to the
 * dev log file).
 */

type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(extra ?? {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const log = {
  info: (scope: string, message: string, extra?: Record<string, unknown>) => emit("info", scope, message, extra),
  warn: (scope: string, message: string, extra?: Record<string, unknown>) => emit("warn", scope, message, extra),
  error: (scope: string, message: string, extra?: Record<string, unknown>) => emit("error", scope, message, extra),
  debug: (scope: string, message: string, extra?: Record<string, unknown>) => emit("debug", scope, message, extra),
};
