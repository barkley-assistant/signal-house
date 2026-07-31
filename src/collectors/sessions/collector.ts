/**
 * Generic local sessions collector — reads session JSON files from an
 * optional directory (SECRET_HOUSE_SESSIONS_DIR). Unconfigured or missing
 * dir → source unavailable (degrades gracefully). Files are bounded to the
 * 100 most recent, each parsed defensively.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Collector, CollectorResult, SessionRecord, SourceData } from "../../shared/types";
import { emptySourceData } from "../../shared/types";

export class SessionsCollector implements Collector<SourceData> {
  readonly id = "sessions" as const;
  readonly tier = "tool" as const;
  readonly title = "Local Sessions";

  constructor(private readonly dir: string | null) {}

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    if (!this.dir || !existsSync(this.dir)) {
      return {
        source: "sessions",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: [this.dir ? `sessions dir not found at ${this.dir}` : "sessions dir not configured (SECRET_HOUSE_SESSIONS_DIR)"],
        errors: [],
        unavailable: true,
      };
    }

    const data = emptySourceData();
    const dir = this.dir; // narrowed: non-null after the guard above
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 100);

    for (const { f } of files) {
      if (signal.aborted) break;
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Partial<SessionRecord>;
        data.sessions.push({
          id: String(raw.id ?? f),
          toolName: String(raw.toolName ?? "unknown"),
          action: String(raw.action ?? "session"),
          timestamp: raw.timestamp ?? new Date(statSync(join(dir, f)).mtimeMs).toISOString(),
          durationMs: typeof raw.durationMs === "number" ? raw.durationMs : null,
          success: raw.success !== false,
          metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
        });
      } catch {
        // skip malformed file — one bad session file must not kill the source
      }
    }

    return {
      source: "sessions",
      ok: true,
      data,
      durationMs: Date.now() - start,
      warnings: [],
      errors: [],
      unavailable: false,
    };
  }
}
