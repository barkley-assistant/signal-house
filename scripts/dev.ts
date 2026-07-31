/**
 * LAN development server wrapper.
 *
 * - Binds the Bun server to 0.0.0.0 on port 3000 (or the next free port).
 * - Writes .signal-house-dev/{pid,port,log,access} (all gitignored).
 * - Prints the localhost URL and the detected LAN URL.
 * - Uses `bun --hot` so server code reloads without dropping connections.
 *
 * Run: bun run dev
 */

import { spawn } from "bun";
import { networkInterfaces } from "node:os";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const devDir = join(repoRoot, ".signal-house-dev");
mkdirSync(devDir, { recursive: true });

function lanIps(): string[] {
  const out: string[] = [];
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

writeFileSync(join(devDir, "pid"), String(pid));
writeFileSync(join(devDir, "port"), String(port));

const logPath = join(devDir, "log");
const accessPath = join(devDir, "access");
writeFileSync(logPath, "");

const ips = lanIps();
const localUrl = `http://localhost:${port}`;
const lanUrl = ips.length > 0 ? `http://${ips[0]}:${port}` : "(no LAN interface found)";

console.log(`\n  Signal House dev server`);
console.log(`  Local:  ${localUrl}`);
console.log(`  LAN:    ${lanUrl}`);
console.log(`  Logs:   ${logPath}`);
console.log(`  PID:    ${pid}\n`);

const child = spawn({
  cmd: ["bun", "--hot", "src/server.ts"],
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

const tee = async (stream: ReadableStream<Uint8Array> | null, file: string): Promise<void> => {
  if (!stream) return;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = Buffer.from(value).toString("utf8");
    process.stdout.write(text);
    appendFileSync(file, text);
  }
};
void tee(child.stdout, logPath);
void tee(child.stderr, logPath);

async function accessWatcher(): Promise<void> {
  appendFileSync(accessPath, "");
  // Periodic marker so the operator can see the server is alive.
  setInterval(() => {
    appendFileSync(accessPath, `${new Date().toISOString()} live (pid ${pid})\n`);
  }, 60_000);
}
void accessWatcher();

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
