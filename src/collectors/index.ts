/**
 * Explicit collector registration (per the rewrite instruction: no dynamic
 * plugin framework). Adding a source = add one entry here.
 */

import type { Collector } from "../shared/types";
import type { RuntimeConfig } from "../config/types";
import { createGithubCollector } from "./github/collector";
import { createGitCollector } from "./git/collector";
import { HermesCollector } from "./hermes/collector";
import { OpencodeCollector } from "./opencode/collector";
import { SessionsCollector } from "./sessions/collector";

export type { Collector } from "../shared/types";

export function createCollectors(config: RuntimeConfig): Collector[] {
  return [
    createGithubCollector(config),
    createGitCollector(config),
    new HermesCollector(config.hermes.dbPath, config.sessions.periodDays),
    new OpencodeCollector(config.opencode.dbPath, config.sessions.periodDays),
    new SessionsCollector(config.sessions.dir),
  ];
}
