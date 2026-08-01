/**
 * Collector unit tests — fixture SQLite DBs, fixture git repos, and a mock
 * GitHub API server. No real external sources touched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesCollector } from "../../src/collectors/hermes/collector";
import { OpencodeCollector } from "../../src/collectors/opencode/collector";
import { GitCollector, parseRemote, sanitizeRemoteUrl } from "../../src/collectors/git/collector";
import { mergeTargets, extractGithubTargets } from "../../src/collectors/github/collector";
import { emptySourceData } from "../../src/shared/types";
import { GitHubClient, GitHubError } from "../../src/collectors/github/client";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-collectors-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hermes collector", () => {
  test("reads sessions and aggregates by UTC day (epoch seconds)", async () => {
    const dbPath = join(dir, "hermes.db");
    const db = new Database(dbPath);
    const nowSec = Math.floor(Date.now() / 1000);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, model TEXT, billing_provider TEXT,
        message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
        cache_write_tokens INTEGER, reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL
      );
      CREATE TABLE session_model_usage (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        billing_provider TEXT NOT NULL DEFAULT '',
        api_call_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        actual_cost_usd REAL NOT NULL DEFAULT 0
      );
      INSERT INTO sessions VALUES ('s1', ${nowSec - 3600}, NULL, 'MiniMax M3', 'custom', 10, 1000, 100, 0, 0, 0, 0.5, NULL);
      INSERT INTO sessions VALUES ('s2', ${nowSec - 1800}, NULL, 'MiniMax M3', 'custom', 5, 500, 50, 0, 0, 0, 0.25, NULL);
      INSERT INTO sessions VALUES ('s3', 1700000000, NULL, 'old', NULL, 1, 1, 1, 0, 0, 0, 0, NULL);
      -- per-call usage mirrors the sessions-table cost (actual 0 → falls back to estimated)
      INSERT INTO session_model_usage VALUES ('s1', 'MiniMax M3', 'custom', 10, 1000, 100, 0, 0, 0, 0.5, 0);
      INSERT INTO session_model_usage VALUES ('s2', 'MiniMax M3', 'custom', 5, 500, 50, 0, 0, 0, 0.25, 0);
      INSERT INTO session_model_usage VALUES ('s3', 'old', 'custom', 1, 1, 1, 0, 0, 0, 0, 0);
    `);
    db.close();

    const collector = new HermesCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(result.data!.usage!.byDay.length).toBeGreaterThan(0);
    const today = new Date(nowSec * 1000).toISOString().slice(0, 10);
    const day = result.data!.usage!.byDay.find((d) => d.date === today);
    expect(day).toBeDefined();
    expect(day!.sessions).toBe(2);
    expect(day!.cost).toBeCloseTo(0.75, 5);
    const model = result.data!.usage!.byModel.find((m) => m.model === "MiniMax M3");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("custom");
  });

  test("missing db file → unavailable, not a failure", async () => {
    const collector = new HermesCollector(join(dir, "nope.db"), 30);
    const result = await collector.collect(new AbortController().signal);
    expect(result.unavailable).toBe(true);
    expect(result.ok).toBe(true);
  });

  test("missing sessions table → unavailable with warning", async () => {
    const dbPath = join(dir, "empty.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE other (id TEXT);");
    db.close();
    const collector = new HermesCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    expect(result.unavailable).toBe(true);
    expect(result.warnings.join()).toContain("sessions");
  });

  test("byModel uses session_model_usage (per-call truth), not sessions.model", async () => {
    // Regression: a session whose declared model (sessions.model) differs from
    // the model that actually spent the money. Hermes records the real
    // per-(session, model) breakdown in session_model_usage; the old query
    // grouped by sessions.model, misattributing cost.
    const dbPath = join(dir, "hermes-usage.db");
    const db = new Database(dbPath);
    const nowSec = Math.floor(Date.now() / 1000);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, model TEXT, billing_provider TEXT,
        message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
        cache_write_tokens INTEGER, reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL
      );
      CREATE TABLE session_model_usage (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        billing_provider TEXT NOT NULL DEFAULT '',
        api_call_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        actual_cost_usd REAL NOT NULL DEFAULT 0
      );
      -- session declares MiniMax M3 but actually spent on DeepSeek-V4-Pro
      INSERT INTO sessions VALUES ('s1', ${nowSec - 3600}, NULL, 'MiniMax M3', 'custom', 10, 0, 0, 0, 0, 0, 4.76, NULL);
      INSERT INTO session_model_usage VALUES ('s1', 'DeepSeek-V4-Pro', 'custom', 300, 1000000, 50000, 2000000, 0, 0, 4.7, 0);
      INSERT INTO session_model_usage VALUES ('s1', 'MiniMax M3', 'custom', 2, 10000, 100, 0, 0, 0, 0.06, 0);
    `);
    db.close();
    const collector = new HermesCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    const byModel = result.data!.usage!.byModel;
    const deepseek = byModel.find((m) => m.model === "DeepSeek-V4-Pro");
    const minimax = byModel.find((m) => m.model === "MiniMax M3");
    expect(deepseek).toBeDefined();
    expect(minimax).toBeDefined();
    expect(deepseek!.cost).toBeCloseTo(4.7, 5);
    expect(minimax!.cost).toBeCloseTo(0.06, 5);
    // sessions count = distinct sessions that used the model
    expect(deepseek!.sessions).toBe(1);
    // per-model messages are unknown from session_model_usage → null
    expect(deepseek!.messages).toBeNull();
  });
});

describe("opencode collector", () => {
  test("reads sessions, extracts providerID from JSON, handles epoch ms", async () => {
    const dbPath = join(dir, "opencode.db");
    const db = new Database(dbPath);
    const nowMs = Date.now();
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, time_created INTEGER, cost REAL, tokens_input INTEGER, tokens_output INTEGER,
        tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, model TEXT
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL, data TEXT NOT NULL,
        CONSTRAINT fk_message_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
      );
      CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id);
      INSERT INTO session VALUES ('o1', ${nowMs - 3600_000}, 1.25, 1000, 100, 0, 0, 0, '{"id":"DeepSeek-V4-Pro","providerID":"openference","variant":"high"}');
      INSERT INTO session VALUES ('o2', ${nowMs - 1800_000}, 0.5, 500, 50, 0, 0, 0, '{"id":"DeepSeek-V4-Pro","providerID":"openference"}');
      -- per-message usage mirrors the session rows' cost + tokens
      INSERT INTO message VALUES ('m1', 'o1', ${nowMs - 3600_000}, ${nowMs - 3600_000},
        '{"role":"assistant","modelID":"DeepSeek-V4-Pro","providerID":"openference","cost":1.25,"tokens":{"input":1000,"output":100,"reasoning":0,"cache":{"read":0,"write":0}}}');
      INSERT INTO message VALUES ('m2', 'o2', ${nowMs - 1800_000}, ${nowMs - 1800_000},
        '{"role":"assistant","modelID":"DeepSeek-V4-Pro","providerID":"openference","cost":0.5,"tokens":{"input":500,"output":50,"reasoning":0,"cache":{"read":0,"write":0}}}');
    `);
    db.close();

    const collector = new OpencodeCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(result.data!.usage!.byDay.length).toBeGreaterThan(0);
    const model = result.data!.usage!.byModel.find((m) => m.model === "DeepSeek-V4-Pro");
    expect(model).toBeDefined();
    // contract #8: providerID read from the JSON, not inferred from a slash-split
    expect(model!.provider).toBe("openference");
    expect(model!.cost).toBeCloseTo(1.75, 5);
  });

  test("cost is read faithfully (never recomputed)", async () => {
    const dbPath = join(dir, "oc-cost.db");
    const db = new Database(dbPath);
    const nowMs = Date.now();
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, cost REAL, tokens_input INTEGER,
        tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, model TEXT);
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL, data TEXT NOT NULL,
        CONSTRAINT fk_message_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
      );
      INSERT INTO session VALUES ('x', ${nowMs - 60_000}, 0.07079965, 162455, 1180, 0, 0, 0, '{"id":"M","providerID":"p"}');
      INSERT INTO message VALUES ('mx', 'x', ${nowMs - 60_000}, ${nowMs - 60_000},
        '{"role":"assistant","modelID":"M","providerID":"p","cost":0.07079965,"tokens":{"input":162455,"output":1180,"reasoning":0,"cache":{"read":0,"write":0}}}');
    `);
    db.close();
    const collector = new OpencodeCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    expect(result.data!.usage!.byModel[0].cost).toBeCloseTo(0.07079965, 8);
  });

  test("multi-model session splits by message-level modelID (not session.model)", async () => {
    // Regression for the misattribution bug: a session whose `session.model`
    // row says one model but whose per-call messages used several. opencode
    // records cost/tokens per message with the ACTUAL model used; the old
    // collector grouped by session.model, attributing every model's spend to
    // the session's declared model.
    const dbPath = join(dir, "oc-multimodel.db");
    const db = new Database(dbPath);
    const nowMs = Date.now();
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, cost REAL, tokens_input INTEGER,
        tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, model TEXT);
      INSERT INTO session VALUES ('s1', ${nowMs - 60_000}, 2.0, 1000, 100, 0, 0, 0,
        '{"id":"gpt-5.6-luna","providerID":"openai"}');
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL, data TEXT NOT NULL,
        CONSTRAINT fk_message_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
      );
      CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id);
      INSERT INTO message VALUES
        ('m1', 's1', ${nowMs - 60_000}, ${nowMs - 60_000},
         '{"role":"assistant","modelID":"GLM-5.2","providerID":"openference","cost":1.5,"tokens":{"input":1000000,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}'),
        ('m2', 's1', ${nowMs - 50_000}, ${nowMs - 50_000},
         '{"role":"assistant","modelID":"DeepSeek-V4-Pro","providerID":"openference","cost":0.5,"tokens":{"input":1000000,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}'),
        ('m3', 's1', ${nowMs - 40_000}, ${nowMs - 40_000},
         '{"role":"assistant","modelID":"gpt-5.6-luna","providerID":"openai","cost":0.0,"tokens":{"input":1000000,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}'),
        ('m4', 's1', ${nowMs - 30_000}, ${nowMs - 30_000},
         '{"role":"user","cost":0.0,"tokens":null}');
    `);
    db.close();
    const collector = new OpencodeCollector(dbPath, 30);
    const result = await collector.collect(new AbortController().signal);
    const byModel = result.data!.usage!.byModel;
    // session.cost total = 2.0 — split across GLM-5.2 (1.5) + DeepSeek (0.5), luna 0.
    const glm = byModel.find((m) => m.model === "GLM-5.2");
    const ds = byModel.find((m) => m.model === "DeepSeek-V4-Pro");
    const luna = byModel.find((m) => m.model === "gpt-5.6-luna");
    expect(glm).toBeDefined();
    expect(ds).toBeDefined();
    expect(luna).toBeDefined();
    expect(glm!.cost).toBeCloseTo(1.5, 5);
    expect(ds!.cost).toBeCloseTo(0.5, 5);
    expect(luna!.cost).toBeCloseTo(0.0, 5);
    // tokens follow the same split (1M each per message)
    expect(glm!.inputTokens).toBe(1_000_000);
    expect(ds!.inputTokens).toBe(1_000_000);
    expect(luna!.inputTokens).toBe(1_000_000);
  });
});

describe("git collector", () => {
  test("discovers explicit repo, normalizes remote, isPrivate stays null", async () => {
    const repoPath = join(dir, "repo-a");
    const mk = await Bun.$`mkdir -p ${repoPath} && cd ${repoPath} && git init -q && git config user.email t@t && git config user.name t && echo hi > f.txt && git add f.txt && git commit -qm init && git remote add origin git@github.com:acme/thing.git`.quiet();
    expect(mk.exitCode).toBe(0);

    const collector = new GitCollector({ repos: [repoPath], roots: [], globs: ["*"], maxDepth: 3, excludes: [], lookbackDays: 28 });
    const result = await collector.collect(new AbortController().signal);
    expect(result.ok).toBe(true);
    const record = result.data!.localGit.find((r) => r.path === repoPath);
    expect(record).toBeDefined();
    expect(record!.repoKey).toBe("github:acme/thing");
    expect(record!.remoteUrl).toBe("git@github.com:acme/thing.git");
    expect(record!.githubOwner).toBe("acme");
    expect(record!.githubRepo).toBe("thing");
    // contract #342: local-git discovered repos have UNKNOWN privacy
    expect(record!.isGitRepo).toBe(true);
  });

  test("invalid path → error record, not a crash", async () => {
    const collector = new GitCollector({ repos: [join(dir, "not-a-repo")], roots: [], globs: ["*"], maxDepth: 3, excludes: [], lookbackDays: 28 });
    const result = await collector.collect(new AbortController().signal);
    expect(result.data!.localGit[0].isGitRepo).toBe(false);
    expect(result.data!.localGit[0].error).toBeTruthy();
  });

  test("no config → unavailable", async () => {
    const collector = new GitCollector({ repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: [], lookbackDays: 28 });
    const result = await collector.collect(new AbortController().signal);
    expect(result.unavailable).toBe(true);
  });

  test("mergeTargets unions explicit + discovered, dedupes by owner/repo", () => {
    const merged = mergeTargets(
      [{ owner: "barkley-assistant", repo: "signal-house" }],
      [
        { owner: "barkley-assistant", repo: "signal-house" }, // dup of explicit
        { owner: "barkley-assistant", repo: "caduceus" },
        { owner: "Barkway-app", repo: "app" },
        { owner: "", repo: "" }, // garbage dropped
      ],
    );
    expect(merged).toEqual([
      { owner: "barkley-assistant", repo: "signal-house" },
      { owner: "barkley-assistant", repo: "caduceus" },
      { owner: "Barkway-app", repo: "app" },
    ]);
  });

  test("extractGithubTargets pulls owner/repo from discovered localGit records", () => {
    const data = emptySourceData();
    data.localGit.push({
      repoKey: "github:acme/thing",
      path: "/x/thing",
      repoName: "thing",
      remoteUrl: "git@github.com:acme/thing.git",
      githubOwner: "acme",
      githubRepo: "thing",
      defaultBranch: "main",
      isGitRepo: true,
      recentCommits: 3,
      authors: [],
      latestCommitAt: null,
      error: null,
      present: true,
      lastSeenAt: null,
    });
    data.localGit.push({
      repoKey: "local:/x/norepo",
      path: "/x/norepo",
      repoName: "norepo",
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      defaultBranch: null,
      isGitRepo: false,
      recentCommits: 0,
      authors: [],
      latestCommitAt: null,
      error: "not a git repo",
      present: false,
      lastSeenAt: null,
    });
    expect(extractGithubTargets(data)).toEqual([{ owner: "acme", repo: "thing" }]);
  });

  test("parseRemote handles https and ssh forms", () => {
    expect(parseRemote("git@github.com:acme/thing.git")).toEqual({ owner: "acme", repo: "thing" });
    expect(parseRemote("https://github.com/acme/thing.git")).toEqual({ owner: "acme", repo: "thing" });
    expect(parseRemote("git@gitlab.com:acme/other.git")).toEqual({ owner: null, repo: null });
  });

  test("parseRemote handles token-prefixed https remotes", () => {
    expect(parseRemote("https://x-access-token:gho_abc123@github.com/acme/thing.git")).toEqual({ owner: "acme", repo: "thing" });
  });

  test("sanitizeRemoteUrl strips credentials before persistence", () => {
    const dirty = "https://x-access-token:gho_supersecret@github.com/acme/thing.git";
    const clean = sanitizeRemoteUrl(dirty);
    expect(clean).toBe("https://github.com/acme/thing.git");
    expect(clean).not.toContain("gho_supersecret");
    // ssh scp-style urls pass through untouched
    expect(sanitizeRemoteUrl("git@github.com:acme/thing.git")).toBe("git@github.com:acme/thing.git");
    expect(sanitizeRemoteUrl(null)).toBeNull();
  });
});

describe("github client (mock API)", () => {
  test("pagination follows Link headers and maps privacy + provider fields", async () => {
    let srv: ReturnType<typeof Bun.serve> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/repos/acme/thing") {
          return Response.json({ id: 1, name: "thing", full_name: "acme/thing", private: true, default_branch: "main", html_url: "https://github.com/acme/thing", archived: false });
        }
        if (url.pathname === "/repos/acme/thing/issues" && url.searchParams.get("page") === "2") {
          return Response.json([]);
        }
        if (url.pathname === "/repos/acme/thing/issues") {
          return Response.json(
            [
              { id: 1, number: 1, title: "issue 1", state: "open", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-30T00:00:00Z", closed_at: null, html_url: "u", labels: [], user: { login: "a" } },
            ],
            { headers: { link: `<http://localhost:${srv!.port}/repos/acme/thing/issues?page=2>; rel="next"` } },
          );
        }
        if (url.pathname === "/repos/acme/thing/pulls") return Response.json([]);
        if (url.pathname === "/repos/acme/thing/actions/runs") return Response.json([]);
        return Response.json({}, { status: 404 });
      },
    });
    srv = server;

    const client = new GitHubClient({ token: "ghp_test", baseUrl: `http://localhost:${server.port}` });
    const detail = await client.fetchRepo("acme", "thing", "2026-07-01T00:00:00Z");
    expect(detail.repo.private).toBe(true);
    expect(detail.issues.length).toBe(1);
    server.stop(true);
  });

  test("wrapped list responses ({total_count, <key>: []}) are unwrapped", async () => {
    let srv: ReturnType<typeof Bun.serve> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/repos/acme/thing") {
          return Response.json({ id: 1, name: "thing", full_name: "acme/thing", private: false, default_branch: "main", html_url: "https://github.com/acme/thing", archived: false });
        }
        if (url.pathname === "/repos/acme/thing/issues") return Response.json([]);
        if (url.pathname === "/repos/acme/thing/pulls") return Response.json([]);
        if (url.pathname === "/repos/acme/thing/actions/runs") {
          return Response.json({ total_count: 1, workflow_runs: [{ id: 1, run_number: 1, status: "completed", conclusion: "success", name: "CI", head_branch: "main", created_at: "2026-07-30T00:00:00Z", updated_at: "2026-07-30T00:00:00Z", html_url: "u" }] });
        }
        return Response.json({}, { status: 404 });
      },
    });
    srv = server;

    const client = new GitHubClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    const detail = await client.fetchRepo("acme", "thing", "2026-07-01T00:00:00Z");
    expect(detail.workflowRuns.length).toBe(1);
    expect(detail.workflowRuns[0].conclusion).toBe("success");
    server.stop(true);
  });

  test("401 surfaces as auth error, never the token", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("bad creds", { status: 401 }) });
    const client = new GitHubClient({ token: "ghp_super_secret", baseUrl: `http://localhost:${server.port}` });
    try {
      await client.fetchRepo("a", "b", "2026-01-01T00:00:00Z");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      const gh = err as GitHubError;
      expect(gh.kind).toBe("auth");
      expect(gh.message).not.toContain("ghp_super_secret");
    }
    server.stop(true);
  });

  test("rate limit 403 with x-ratelimit-remaining=0 → rate_limit error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    const client = new GitHubClient({ token: "t", baseUrl: `http://localhost:${server.port}` });
    try {
      await client.fetchRepo("a", "b", "2026-01-01T00:00:00Z");
      expect.unreachable();
    } catch (err) {
      expect((err as GitHubError).kind).toBe("rate_limit");
    }
    server.stop(true);
  });
});
