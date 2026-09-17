/**
 * Aggregates windowing tests — the dashboard time-range filter (7/30/90 days)
 * is implemented server-side in computeAggregates. These pin the windowing
 * contract: usage totals slice byDay, byModel picks the precomputed per-window
 * breakdown (falling back to the period aggregate), cycle time counts only
 * PRs merged inside the window, and throughput/CI are window-filtered.
 */

import { describe, expect, test } from "bun:test";
import type { PersistedState } from "../../src/config/types";
import type { RuntimeConfig } from "../../src/config/types";
import type { SourceData } from "../../src/shared/types";
import { computeAggregates, mergeModelRows, type UsageAggregate } from "../../src/orchestrator/aggregates";
import { emptySourceData } from "../../src/shared/types";
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

const config: RuntimeConfig = {
  dev: false,
  environment: "production",
  host: "0.0.0.0",
  port: 8999,
  db: { dir: "/tmp", file: "metrics.db", path: "/tmp/metrics.db" },
  auth: { username: "signal-house", password: "", enabled: false },
  github: { token: null, owner: null, repo: null },
  git: { repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: [] },
  hermes: { dbPath: "/tmp/hermes.db", profilesDir: null },
  opencode: { dbPath: "/tmp/opencode.db" },
  usage: { periodDays: 90 },
  poller: { enabled: false, intervalSeconds: 300, startupDelaySeconds: 5, runOnStartup: true },
  orchestrator: { concurrency: 3, lookbackDays: 90, githubIntervalSeconds: 600 },
  staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
  retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
  privacy: { showPrivateRepoItems: false },
  refresh: { lockStaleMs: 600_000 },
    estimateCosts: false,
    hostMetrics: { enabled: false },
};

function state(source: string, data: SourceData): PersistedState {
  return {
    source: source as PersistedState["source"],
    ok: true,
    unavailable: false,
    capturedAt: Date.now(),
    window: { start: utcDaysAgo(90), end: utcDay() },
    data,
    warnings: [],
    errors: [],
    usage: data.usage,
  };
}

/** Usage fixture: N days of byDay ending today, each day one session worth $1. */
function usageDays(n: number): PersistedState {
  const data = emptySourceData();
  data.usage = {
    source: "hermes",
    periodDays: 90,
    byDay: Array.from({ length: n }, (_, i) => {
      const date = utcDaysAgo(n - 1 - i);
      return {
        date,
        sessions: 1,
        messages: 2,
        tokensInput: 1000,
        tokensOutput: 100,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensReasoning: 0,
        cost: 1,
      };
    }),
    byModel: [],
  };
  return state("hermes", data);
}

describe("computeAggregates windowing", () => {
  test("window reflects the requested days; default is 30", () => {
    const s = usageDays(40);
    expect(computeAggregates({ states: [s], config }).window.days).toBe(30);
    expect(computeAggregates({ states: [s], config }).window.start).toBe(utcDaysAgo(30));
    expect(computeAggregates({ states: [s], config, days: 7 }).window.days).toBe(7);
    expect(computeAggregates({ states: [s], config, days: 90 }).window.start).toBe(utcDaysAgo(90));
  });

  test("usage totals slice byDay to the window", () => {
    const s = usageDays(40); // $1 per day, 40 days of history
    const a7 = computeAggregates({ states: [s], config, days: 7 });
    // Window is [today-7, today] inclusive — 8 calendar days of $1 rows.
    expect(a7.usage!.totalSessions).toBe(8);
    expect(a7.usage!.totalCost).toBeCloseTo(8, 5);

    const a90 = computeAggregates({ states: [s], config, days: 90 });
    expect(a90.usage!.totalSessions).toBe(40);
    expect(a90.usage!.totalCost).toBeCloseTo(40, 5);
  });

  test("bySource slices to the window too", () => {
    const s = usageDays(40);
    const a7 = computeAggregates({ states: [s], config, days: 7 });
    expect(a7.usage!.bySource.hermes.sessions).toBe(8);
    expect(a7.usage!.bySource.hermes.cost).toBeCloseTo(8, 5);
  });

  test("usageOverride (daily_metrics history) wins when provided", () => {
    const s = usageDays(40);
    const override: UsageAggregate = {
      totalSessions: 999,
      totalMessages: null,
      totalTokens: 1000,
      totalCost: 42,
      bySource: { opencode: { sessions: 999, cost: 42, tokens: 1000 } },
      byModel: [{ model: "Weekmodel", family: null, sessions: 2, cost: 2, tokens: 2 }],
    };
    const a = computeAggregates({ states: [s], config, days: 7, usageOverride: override });
    expect(a.usage!.totalSessions).toBe(999);
    expect(a.usage!.totalCost).toBeCloseTo(42, 5);
    expect(a.usage!.byModel[0].model).toBe("Weekmodel");
  });

  test("usage falls back to the snapshot when no history override is given", () => {
    const s = usageDays(40);
    const a = computeAggregates({ states: [s], config, days: 7 });
    expect(a.usage!.totalSessions).toBe(8);
    expect(a.usage!.totalCost).toBeCloseTo(8, 5);
  });

  test("cycle time counts only PRs merged inside the window", () => {
    const data = emptySourceData();
    const iso = (daysAgo: number, hour = 10): string => {
      // Anchor the fixture to the current UTC day so the test stays valid
      // regardless of the calendar date the suite runs on.
      const [y, m, d] = utcDaysAgo(daysAgo).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
    };
    data.pullRequests = [
      // merged 40 days ago — inside a 90-day window, outside a 7-day one
      { id: "old", repoKey: "r", repo: "r", title: "old", state: "closed", url: "", author: "u", createdAt: iso(41), updatedAt: iso(40), mergedAt: iso(40), closedAt: iso(40), headSha: null, labels: [], additions: null, deletions: null, changedFiles: null, ciStatus: null },
      // merged yesterday — inside both windows
      { id: "new", repoKey: "r", repo: "r", title: "new", state: "closed", url: "", author: "u", createdAt: iso(2), updatedAt: iso(1), mergedAt: iso(1), closedAt: iso(1), headSha: null, labels: [], additions: null, deletions: null, changedFiles: null, ciStatus: null },
    ];
    // Aggregates apply the privacy filter (fail-closed): declare "r" public.
    data.repositories = [{ repoKey: "github:r", name: "r", localPath: null, remoteUrl: null, githubOwner: "r", githubRepo: "r", source: "github", isPrivate: false, present: true, lastSeenAt: null }];
    // ...and the PRs must reference that key to be visible.
    for (const pr of data.pullRequests) pr.repoKey = "github:r";
    const s = state("github", data);

    const a7 = computeAggregates({ states: [s], config, days: 7 });
    expect(a7.cycleTime!.sampleSize).toBe(1);
    // 41h-2h... merged yesterday created 2 days ago → ~24h+ delta in seconds
    expect(a7.cycleTime!.medianSeconds).toBeCloseTo((Date.parse(iso(1)) - Date.parse(iso(2))) / 1000, 2);

    const a90 = computeAggregates({ states: [s], config, days: 90 });
    expect(a90.cycleTime!.sampleSize).toBe(2);
  });

  test("throughput and CI are window-filtered", () => {
    const data = emptySourceData();
    const day = (daysAgo: number): string => utcDaysAgo(daysAgo);
    // Aggregates apply the privacy filter (fail-closed): declare "r" public.
    data.repositories = [{ repoKey: "github:r", name: "r", localPath: null, remoteUrl: null, githubOwner: "r", githubRepo: "r", source: "github", isPrivate: false, present: true, lastSeenAt: null }];
    data.issues = [
      { id: "i1", repoKey: "github:r", repo: "r", title: "recent", state: "closed", url: "", createdAt: day(2), updatedAt: day(2), closedAt: day(2), labels: [], assignee: null, milestone: null },
      { id: "i2", repoKey: "github:r", repo: "r", title: "old", state: "closed", url: "", createdAt: day(40), updatedAt: day(40), closedAt: day(40), labels: [], assignee: null, milestone: null },
    ];
    data.workflowRuns = [
      { id: "w1", name: "ci", status: "completed", conclusion: "success", createdAt: day(1), completedAt: day(1), headSha: "a", repo: "r", repoKey: "github:r", branch: "main", workflowName: "ci", url: "" },
      { id: "w2", name: "ci", status: "completed", conclusion: "failure", createdAt: day(35), completedAt: day(35), headSha: "b", repo: "r", repoKey: "github:r", branch: "main", workflowName: "ci", url: "" },
    ];
    const s = state("github", data);

    const a7 = computeAggregates({ states: [s], config, days: 7 });
    expect(a7.throughput!.issuesClosed).toBe(1);
    expect(a7.ci!.totalRuns).toBe(1);
    expect(a7.ci!.passRate).toBeCloseTo(1, 5);

    const a90 = computeAggregates({ states: [s], config, days: 90 });
    expect(a90.throughput!.issuesClosed).toBe(2);
    expect(a90.ci!.totalRuns).toBe(2);
    expect(a90.ci!.passRate).toBeCloseTo(0.5, 5);
  });
});

describe("CI conclusion accounting", () => {
  const day = (daysAgo: number): string => utcDaysAgo(daysAgo);

  /** Github fixture: one public repo, one run per conclusion value, all in-window. */
  function ghStateWithRuns(conclusions: Array<string | null>): PersistedState {
    const data = emptySourceData();
    data.repositories = [{ repoKey: "github:r", name: "r", localPath: null, remoteUrl: null, githubOwner: "r", githubRepo: "r", source: "github", isPrivate: false, present: true, lastSeenAt: null }];
    data.workflowRuns = conclusions.map((conclusion, i) => ({
      id: `w${i}`,
      name: "ci",
      status: conclusion === null ? "in_progress" : "completed",
      conclusion,
      createdAt: day(1),
      completedAt: conclusion === null ? null : day(1),
      headSha: `s${i}`,
      repo: "r",
      repoKey: "github:r",
      branch: "main",
      workflowName: "ci",
      url: "",
    }));
    return state("github", data);
  }

  test("pass + fail + other === totalRuns: skipped/cancelled/null runs accounted, not dropped", () => {
    const s = ghStateWithRuns(["success", "failure", "skipped", "cancelled", "neutral", "timed_out", null]);
    const a = computeAggregates({ states: [s], config, days: 7 });
    expect(a.ci!.totalRuns).toBe(7);
    expect(a.ci!.passCount).toBe(1);
    expect(a.ci!.failCount).toBe(1);
    expect(a.ci!.otherCount).toBe(5);
    expect(a.ci!.passCount + a.ci!.failCount + a.ci!.otherCount).toBe(a.ci!.totalRuns);
  });

  test("passRate stays terminal-only (pass / (pass + fail)) when others are present", () => {
    const s = ghStateWithRuns(["success", "skipped", "cancelled"]);
    const a = computeAggregates({ states: [s], config, days: 7 });
    // 1 pass of 1 terminal run — the 2 skipped/cancelled runs must not
    // enter the denominator.
    expect(a.ci!.passRate).toBeCloseTo(1, 5);
  });

  test("all-non-terminal window: ci non-null, passRate null (unknown, not 0%), otherCount === totalRuns", () => {
    const s = ghStateWithRuns(["skipped", null, "cancelled"]);
    const a = computeAggregates({ states: [s], config, days: 7 });
    expect(a.ci).not.toBeNull();
    expect(a.ci!.passRate).toBeNull();
    expect(a.ci!.otherCount).toBe(3);
  });
});

describe("mergeModelRows cache preservation", () => {
  test("preserves cacheReadTokens and source discrimination", () => {
    const rows = [
      { model: "deepseek-v4-pro", provider: null, source: "hermes", sessions: 2, messages: null, inputTokens: 700, outputTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 0, reasoningTokens: 0, cost: 1 },
      { model: "DeepSeek-V4-Pro", provider: null, source: "opencode", sessions: 1, messages: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000, cacheWriteTokens: 0, reasoningTokens: 0, cost: 2 },
    ];
    const merged = mergeModelRows(rows, { rates: new Map(), enabled: false });
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.model).toBe("DeepSeek V4 Pro");
    expect(m.sessions).toBe(3);
    expect(m.cacheReadTokens).toBe(1300);
    // (1300 / (1300 + 700)) = 0.65
    expect(m.cacheHitRate).toBeCloseTo(1300 / 2000, 5);
    expect(Object.keys(m.bySource ?? {})).toContain("hermes");
    expect(Object.keys(m.bySource ?? {})).toContain("opencode");
    expect((m.bySource ?? {}).hermes.cacheReadTokens).toBe(300);
    expect((m.bySource ?? {}).opencode.cacheReadTokens).toBe(1000);
  });

  test("handles rows without source using provider fallback", () => {
    const rows = [
      { model: "kimi-k27-code", provider: "opencode", source: undefined, sessions: 1, messages: null, inputTokens: 100, outputTokens: 0, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0, cost: 1 },
    ];
    const merged = mergeModelRows(rows, { rates: new Map(), enabled: false });
    expect(merged[0].cacheReadTokens).toBe(100);
    expect(Object.keys(merged[0].bySource ?? {})).toContain("opencode");
  });

  test("per-variant estimator math: 0731 row priced with dated rates, bare row with base rates", () => {
    const rates = new Map([
      ["deepseek-v4-flash", { input: 0.07938, output: 0.15876, cacheRead: 0.015876 }],
      ["deepseek-v4-flash-0731", { input: 0.14, output: 0.28, cacheRead: 0.014 }],
    ]);
    const rows = [
      { model: "DeepSeek-V4-Flash-0731", provider: null, source: "hermes", sessions: 1, messages: null,
        inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
    ];
    const merged = mergeModelRows(rows, { rates, enabled: true });
    expect(merged[0].cost).toBeCloseTo(0.14 + 0.28 + 0.014, 6); // exactly (in·1M + out·1M + cache·1M)/1M
  });

  test("dated flash 0731 merges into the bare flash row, priced at its own dated rates", () => {
    const rates = new Map([
      ["deepseek-v4-flash", { input: 0.07, output: 0.14, cacheRead: 0.014 }],
      // fetchAllRates resolves the dated spelling to its own dated entry
      // (openference preferred), so the prebuilt map carries both keys.
      ["deepseek-v4-flash-0731", { input: 0.14, output: 0.28, cacheRead: 0.014 }],
    ]);
    const rows = [
      { model: "DeepSeek-V4-Flash", provider: null, source: "hermes", sessions: 1, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
      { model: "DeepSeek-V4-Flash-0731", provider: null, source: "hermes", sessions: 1, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
    ];
    const merged = mergeModelRows(rows, { rates, enabled: true });
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.model).toBe("DeepSeek V4 Flash");
    expect(m.machineKey).toBe("deepseek-v4-flash");
    expect(m.sessions).toBe(2);
    expect(m.costSource).toBe("estimated");
    // Each spelling keeps its own rates: bare 0.07 + dated 0.14 (per 1M input tokens).
    expect(m.cost).toBeCloseTo(0.07 + 0.14, 6);
  });

  test("900k variant merges into the canonical model row and prices at canonical rates", () => {
    const rates = new Map([
      ["gpt-56-luna", { input: 0.4, output: 1.8, cacheRead: 0.04 }],
      // fetchAllRates resolves the 900k spelling to the canonical entry,
      // so the prebuilt map carries both keys (buildState's contract).
      ["gpt-56-luna-900k", { input: 0.4, output: 1.8, cacheRead: 0.04 }],
    ]);
    const rows = [
      { model: "GPT 5.6 Luna", provider: null, source: "opencode", sessions: 2, messages: null, inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
      { model: "Gpt 5.6 Luna 900k", provider: null, source: "hermes", sessions: 3, messages: null, inputTokens: 1_000_000, outputTokens: 50_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
    ];
    const merged = mergeModelRows(rows, { rates, enabled: true });
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.model).toBe("GPT 5.6 Luna");
    expect(m.machineKey).toBe("gpt-56-luna");
    expect(m.sessions).toBe(5);
    expect(m.costSource).toBe("estimated");
    // (0.4 + 1.8·0.1 + 0.04·0.5) + (0.4 + 1.8·0.05 + 0.04·1) — per-1M math
    expect(m.cost).toBeCloseTo((0.4 + 0.18 + 0.02) + (0.4 + 0.09 + 0.04), 6);
  });

  test("Muse Spark 1.3 Contributor merges under Muse Spark 1.3 with its own cheaper rates", () => {
    const rates = new Map([
      ["muse-spark-13", { input: 1.25, output: 4.25, cacheRead: 0.15 }],
      ["muse-spark-13-contributor", { input: 0.1, output: 0.2, cacheRead: 0.002 }],
    ]);
    const rows = [
      { model: "Muse Spark 1.3", provider: null, source: "opencode", sessions: 1, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
      { model: "Muse Spark 1.3 Contributor", provider: null, source: "hermes", sessions: 1, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
    ];
    const merged = mergeModelRows(rows, { rates, enabled: true });
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.model).toBe("Muse Spark 1.3");
    expect(m.machineKey).toBe("muse-spark-13");
    expect(m.family).toBe("Meta");
    expect(m.costSource).toBe("estimated");
    expect(m.cost).toBeCloseTo(1.25 + 0.1, 6);
  });

  test("future terra/sol 900k rows merge into their base model rows and price at base rates", () => {
    const rates = new Map([
      ["gpt-56-terra", { input: 4, output: 18, cacheRead: 0.4 }],
      ["gpt-56-sol", { input: 4, output: 15, cacheRead: 0.4 }],
      // fetchAllRates resolves -900k spellings to the canonical entries,
      // so the prebuilt map carries both spellings (buildState's contract).
      ["gpt-56-terra-900k", { input: 4, output: 18, cacheRead: 0.4 }],
      ["gpt-56-sol-900k", { input: 4, output: 15, cacheRead: 0.4 }],
    ]);
    const rows = [
      { model: "GPT 5.6 Terra", provider: null, source: "opencode", sessions: 2, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
      { model: "Gpt 5.6 Terra 900k", provider: null, source: "hermes", sessions: 3, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
      { model: "Gpt 5.6 Sol 900k", provider: null, source: "hermes", sessions: 1, messages: null, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: null },
    ];
    const merged = mergeModelRows(rows, { rates, enabled: true });
    expect(merged).toHaveLength(2);
    const terra = merged.find((m) => m.machineKey === "gpt-56-terra");
    const sol = merged.find((m) => m.machineKey === "gpt-56-sol");
    expect(terra?.model).toBe("GPT 5.6 Terra");
    expect(terra?.sessions).toBe(5);
    expect(terra?.costSource).toBe("estimated");
    expect(terra?.cost).toBeCloseTo(4 + 4, 6);
    expect(sol?.model).toBe("GPT 5.6 Sol");
    expect(sol?.sessions).toBe(1);
    expect(sol?.costSource).toBe("estimated");
    expect(sol?.cost).toBeCloseTo(4, 6);
  });
});

describe("computeAggregates privacy filtering", () => {
  const OLD = new Date(Date.now() - 40 * 86_400_000).toISOString(); // 40d ago — past any threshold
  const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString();

  /** Github fixture: one public repo with a fresh open issue, one private
      repo with a stale open issue + an old workflow run. */
  function ghState(): PersistedState {
    const data = emptySourceData();
    data.repositories = [
      { repoKey: "github:acme/public", name: "public", localPath: null, remoteUrl: null, githubOwner: "acme", githubRepo: "public", source: "github", isPrivate: false, present: true, lastSeenAt: null },
      { repoKey: "github:acme/secret", name: "secret", localPath: null, remoteUrl: null, githubOwner: "acme", githubRepo: "secret", source: "github", isPrivate: true, present: true, lastSeenAt: null },
    ];
    data.issues = [
      { id: "1", title: "fresh public", state: "open", createdAt: RECENT, updatedAt: RECENT, closedAt: null, repo: "acme/public", repoKey: "github:acme/public", labels: [], assignee: null, milestone: null, url: "" },
      { id: "2", title: "stale private", state: "open", createdAt: OLD, updatedAt: OLD, closedAt: null, repo: "acme/secret", repoKey: "github:acme/secret", labels: [], assignee: null, milestone: null, url: "" },
    ];
    data.pullRequests = [];
    data.workflowRuns = [
      { id: "1", name: "ci", status: "completed", conclusion: "success", createdAt: RECENT, completedAt: null, headSha: "abc", repo: "acme/secret", repoKey: "github:acme/secret", branch: "main", workflowName: "CI", url: "" },
    ];
    return state("github", data);
  }

  test("stale counts exclude private repos when showPrivateRepoItems is off", () => {
    const agg = computeAggregates({ states: [ghState()], config });
    // The private stale issue must NOT leak into the card...
    expect(agg.staleWork?.staleIssues).toBe(0);
    // ...but the public in-window issue still counts.
    expect(agg.throughput?.issuesOpened ?? 0).toBe(1);
  });

  test("stale counts include private repos on the explicit operator opt-in", () => {
    const cfg = { ...config, privacy: { showPrivateRepoItems: true } };
    const agg = computeAggregates({ states: [ghState()], config: cfg });
    expect(agg.staleWork?.staleIssues).toBe(1);
    expect(agg.throughput?.issuesOpened ?? 0).toBe(1);
  });

  test("fail-closed: issues from repos missing from the map are excluded too", () => {
    const s = ghState();
    s.data!.issues.push({ id: "3", title: "ghost repo issue", state: "open", createdAt: OLD, updatedAt: OLD, closedAt: null, repo: "acme/unlisted", repoKey: "github:acme/unlisted", labels: [], assignee: null, milestone: null, url: "" });
    const agg = computeAggregates({ states: [s], config });
    expect(agg.staleWork?.staleIssues).toBe(0);
  });
});
