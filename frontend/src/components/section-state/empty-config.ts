import type { EmptyStateConfig, SectionKind } from "./types";

export const emptyStateConfigs: Record<SectionKind, EmptyStateConfig> = {
  health: {
    message: "No metrics collected yet",
    hint: "Check that data collectors are configured",
  },
  trends: {
    message: "No trend data yet",
    hint: "Data appears once daily rollups exist",
  },
  attention: {
    message: "No items need attention",
    hint: "All tracked items are up to date",
  },
  "model-usage": {
    message: "No model usage recorded",
    hint: "OpenCode provider data appears after sessions",
  },
  "session-usage": {
    message: "No session data yet",
    hint: "Configure OpenCode stats collection",
  },
};
