/**
 * LAN development server wrapper.
 *
 * - Binds the Bun server to 0.0.0.0 on port 3000 (or the next free port).
 * - Writes .signal-house-dev/{pid,port,log,access} (all gitignored).
 * - Prints the localhost URL and the detected LAN URL.
 * - Runs a server watcher (`bun --watch src/server.ts`; hard restart because
 *   Bun.serve() binds at module top level — no WebSockets to preserve) and a
 *   web-bundle rebuild triggered by recursive fs.watch on src/web.
 *
 * Run: bun run dev
 */

import { spawn } from "bun";
import { networkInterfaces } from "node:os";
import { mkdirSync, appendFileSync, watch } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const devDir = join(repoRoot, ".signal-house-dev");
mkdirSync(devDir, { recursive: true });

function lanIps(): string[] {
  const out: string[] = [];
  // node:os in Bun is a native implementation (no JS shim); Bun.networkInterfaces
  // is not available until later Bun versions, so this stays node:os.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function portInUse(port: number): boolean {
  try {
    const res = Bun.serve({ port, fetch: () => new Response("probe") });
    res.stop(true);
    return false;
  } catch {
    return true;
  }
}

function pickPort(preferred: number): number {
  for (let p = preferred; p < preferred + 50; p++) {
    if (!portInUse(p)) return p;
  }
  throw new Error("no free port found in range");
}

const preferred = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const port = pickPort(preferred);
const pid = process.pid;

await Bun.write(join(devDir, "pid"), String(pid));
await Bun.write(join(devDir, "port"), String(port));

const logPath = join(devDir, "log");
const accessPath = join(devDir, "access");
await Bun.write(logPath, "");

const ips = lanIps();
const localUrl = `http://localhost:${port}`;
const lanUrl = ips.length > 0 ? `http://${ips[0]}:${port}` : "(no LAN interface found)";

console.log(`\n  Signal House dev server`);
console.log(`  Local:  ${localUrl}`);
console.log(`  LAN:    ${lanUrl}`);
console.log(`  Logs:   ${logPath}`);
console.log(`  PID:    ${pid}\n`);

async function tee(stream: ReadableStream<Uint8Array> | null, file: string): Promise<void> {
  if (!stream) return;
  // Streaming TextDecoder keeps multi-byte UTF-8 intact across chunk
  // boundaries (a per-chunk Buffer.from would mangle split sequences).
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    process.stdout.write(text);
    appendFileSync(file, text);
  }
  const tail = decoder.decode();
  if (tail) {
    process.stdout.write(tail);
    appendFileSync(file, tail);
  }
}

const child = spawn({
  cmd: ["bun", "--watch", "src/server.ts"],
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    HOST: "0.0.0.0",
    SIGNAL_HOUSE_DEV: "1",
  },
});

void tee(child.stdout, logPath);
void tee(child.stderr, logPath);

// Web-bundle rebuild on src/web edits (CSS/TSX). A debounced spawn of
// scripts/build-web.ts keeps rebuilds cheap during multi-file saves.
const webDir = join(repoRoot, "src", "web");
let buildTimer: ReturnType<typeof setTimeout> | null = null;
const rebuildWeb = (): void => {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    const builder = spawn({
      cmd: ["bun", "scripts/build-web.ts"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...(process.env as Record<string, string>) },
    });
    void tee(builder.stdout, logPath);
    void tee(builder.stderr, logPath);
  }, 300);
};
watch(webDir, { recursive: true }, () => rebuildWeb());
rebuildWeb();

// Periodic marker so the operator can see the wrapper is alive.
setInterval(() => {
  appendFileSync(accessPath, `${new Date().toISOString()} live (pid ${pid})\n`);
}, 60_000);

process.on("SIGINT", () => {
  child.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  child.kill();
  process.exit(0);
});

await child.exited;
console.log("\n[dev] server process exited");
process.exit(child.exitCode ?? 0);
