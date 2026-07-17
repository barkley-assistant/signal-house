import type { DashboardWindowCards } from "@/types";

export type StatusLevel =
  | "healthy"
  | "warning"
  | "critical"
  | "empty"
  | "unknown";

export function throughputStatus(
  status: string | undefined,
): StatusLevel {
  if (!status) return "unknown";
  if (status === "available") return "healthy";
  if (status === "partial") return "warning";
  if (status === "stale") return "warning";
  if (status === "empty") return "empty";
  return "critical";
}

export function cycleTimeStatus(
  card:
    | { medianSeconds: number | null; averageSeconds: number | null; status: string }
    | undefined,
): StatusLevel {
  if (!card) return "unknown";
  if (
    card.status === "unavailable" ||
    card.status === "error" ||
    card.status === "unconfigured"
  )
    return "critical";
  if (card.status === "empty") return "empty";
  const seconds = card.medianSeconds ?? card.averageSeconds;
  if (seconds == null) return "empty";
  if (seconds <= 3 * 86400) return "healthy";
  if (seconds <= 7 * 86400) return "warning";
  return "critical";
}

export function ciStatus(
  card: { passRate: number | null; status: string } | undefined,
): StatusLevel {
  if (!card) return "unknown";
  if (
    card.status === "unavailable" ||
    card.status === "error" ||
    card.status === "unconfigured"
  )
    return "critical";
  if (card.status === "empty") return "empty";
  if (card.passRate == null) return "empty";
  if (card.passRate >= 0.9) return "healthy";
  if (card.passRate >= 0.7) return "warning";
  return "critical";
}

export function staleWorkStatus(
  card: { staleIssues: number; stalePrs: number; status: string } | undefined,
): StatusLevel {
  if (!card) return "unknown";
  if (
    card.status === "unavailable" ||
    card.status === "error" ||
    card.status === "unconfigured"
  )
    return "critical";
  if (card.status === "empty") return "empty";
  const total = card.staleIssues + card.stalePrs;
  if (total === 0) return "healthy";
  if (total <= 3) return "warning";
  return "critical";
}

export function overallScore(cards: DashboardWindowCards | null): number {
  if (!cards) return 0;
  let score = 0;
  if (throughputStatus(cards.throughput.status) === "healthy") score += 1;
  if (cycleTimeStatus(cards.cycleTime) === "healthy") score += 1;
  if (ciStatus(cards.ci) === "healthy") score += 1;
  if (staleWorkStatus(cards.staleWork) === "healthy") score += 1;
  return score;
}

export function overallLabel(score: number): string {
  if (score >= 4) return "Healthy";
  if (score >= 3) return "Fair";
  if (score >= 2) return "Watch";
  if (score >= 1) return "At Risk";
  return "Critical";
}

export function overallStatus(score: number): StatusLevel {
  if (score >= 4) return "healthy";
  if (score >= 2) return "warning";
  if (score >= 1) return "critical";
  return "empty";
}
