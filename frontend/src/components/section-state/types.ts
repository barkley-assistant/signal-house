export type SectionState =
  | "data-available"
  | "loading"
  | "empty"
  | "error"
  | "unavailable"
  | "stale"
  | "partial";

export type SectionKind =
  | "health"
  | "trends"
  | "attention"
  | "model-usage"
  | "session-usage"
  | "diagnostics"
  | "cost-breakdown";

export interface EmptyStateConfig {
  message: string;
  hint: string;
}

export interface SectionStateProps {
  state: SectionState;
  section: SectionKind;
  errorMessage?: string;
  onRetry?: () => void;
  children?: React.ReactNode;
  minHeight?: string;
  staleOverlay?: boolean;
  partialIndicator?: boolean;
}
