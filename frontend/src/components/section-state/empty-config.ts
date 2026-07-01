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
    hint: "OpenCode stats appear after the next refresh",
  },
  "session-usage": {
    message: "No session data yet",
    hint: "OpenCode stats appear after the next refresh",
  },
  diagnostics: {
    message: "No diagnostics available",
    hint: "Diagnostics appear after the first data refresh",
  },
  "cost-breakdown": {
    message: "No cost data available",
    hint: "Cost data appears once model usage includes cost information",
  },
};
