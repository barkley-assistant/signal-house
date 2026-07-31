/**
 * Bounded subprocess runner for local commands (git, …).
 *
 * Guarantees: timeout, exit-code checking, bounded output, no shell
 * interpolation (args array only, never a shell string with untrusted data),
 * and no environment leakage into logs.
 */

import { spawn } from "bun";

export interface CommandResult {
  ok: boolean;
  /** null when the process was killed by timeout or signal. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandOptions {
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  /** Extra env vars merged over process.env (never secrets in logs). */
  env?: Record<string, string>;
}

const DEFAULT_MAX_OUTPUT = 256 * 1024;

export async function runCommand(options: CommandOptions): Promise<CommandResult> {
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn({
      cmd: [options.args[0], ...options.args.slice(1)],
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...(process.env as Record<string, string>),
        // Never let git block on a credential prompt in a background daemon.
        GIT_TERMINAL_PROMPT: "0",
        ...(options.env ?? {}),
      },
    });
  } catch (err) {
    // Spawn itself can throw (missing binary, bad cwd, permission) — surface
    // as a failed result rather than crashing the caller.
    return { ok: false, code: null, stdout: "", stderr: (err as Error).message, timedOut: false };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, options.timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([readBounded(proc.stdout, maxOutput), readBounded(proc.stderr, maxOutput)]);
    const exit = await proc.exited;
    return {
      ok: !timedOut && exit === 0,
      code: timedOut ? null : exit,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      truncated = true;
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total = maxBytes;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  reader.releaseLock();
  let text = Buffer.concat(chunks).toString("utf8");
  if (truncated) text += "\n[output truncated]";
  return text;
}
