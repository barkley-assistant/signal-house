/**
 * Build-output hygiene for the web bundle.
 *
 * Hashed chunk filenames change on every build, so a bundler that only ever
 * writes leaves every previous build on disk: after seven weeks 351 of 353
 * chunks in dist/public were unreachable from index.html — 385 MB of dead
 * output on the live box. The bundle must prune what it did not just emit.
 *
 * The second test is the guard on ordering: the verbatim PWA files (sw.js,
 * manifest, offline fallback, icons) are copied AFTER the bundle, so a sweep
 * that compares against a pre-copy listing would delete them every build —
 * which would quietly break offline boot rather than fail loudly.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWebBundle } from "../../src/shared/web-assets";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-web-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildWebBundle", () => {
  test("prunes hashed output the current build did not emit", async () => {
    // Stand in for an earlier build: names this build will never reproduce.
    writeFileSync(join(dir, "chunk-00000000.js"), "// stale");
    writeFileSync(join(dir, "chunk-00000000.css"), "/* stale */");

    await buildWebBundle(dir);

    expect(existsSync(join(dir, "chunk-00000000.js"))).toBe(false);
    expect(existsSync(join(dir, "chunk-00000000.css"))).toBe(false);

    // The new bundle still landed, and only files it produced remain.
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    const chunks = readdirSync(dir).filter((f) => f.startsWith("chunk-"));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((f) => f.includes("00000000"))).toBe(false);
  });

  test("keeps the verbatim PWA files copied alongside the bundle", async () => {
    writeFileSync(join(dir, "chunk-00000000.js"), "// stale");

    await buildWebBundle(dir);

    expect(existsSync(join(dir, "sw.js"))).toBe(true);
    expect(existsSync(join(dir, "manifest.webmanifest"))).toBe(true);
    expect(existsSync(join(dir, "offline.html"))).toBe(true);
  });
});
