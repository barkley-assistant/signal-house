import { describe, expect, it } from "vitest";
import { emptyStateConfigs } from "../empty-config";
import type { SectionKind } from "../types";

describe("emptyStateConfigs", () => {
  const allSections: SectionKind[] = [
    "health",
    "trends",
    "attention",
    "model-usage",
    "session-usage",
  ];

  it("has a config for every section kind", () => {
    for (const section of allSections) {
      expect(emptyStateConfigs[section]).toBeDefined();
    }
  });

  it("every config has a non-empty message and hint", () => {
    for (const section of allSections) {
      const config = emptyStateConfigs[section];
      expect(config.message.length).toBeGreaterThan(0);
      expect(config.hint.length).toBeGreaterThan(0);
    }
  });

  it("health config has expected values", () => {
    expect(emptyStateConfigs.health.message).toBe("No metrics collected yet");
    expect(emptyStateConfigs.health.hint).toBe(
      "Check that data collectors are configured"
    );
  });

  it("trends config has expected values", () => {
    expect(emptyStateConfigs.trends.message).toBe("No trend data yet");
    expect(emptyStateConfigs.trends.hint).toBe(
      "Data appears once daily rollups exist"
    );
  });

  it("attention config has expected values", () => {
    expect(emptyStateConfigs.attention.message).toBe(
      "No items need attention"
    );
    expect(emptyStateConfigs.attention.hint).toBe(
      "All tracked items are up to date"
    );
  });

  it("model-usage config has expected values", () => {
    expect(emptyStateConfigs["model-usage"].message).toBe(
      "No model usage recorded"
    );
    expect(emptyStateConfigs["model-usage"].hint).toBe(
      "OpenCode provider data appears after sessions"
    );
  });

  it("session-usage config has expected values", () => {
    expect(emptyStateConfigs["session-usage"].message).toBe(
      "No session data yet"
    );
    expect(emptyStateConfigs["session-usage"].hint).toBe(
      "Configure OpenCode stats collection"
    );
  });
});
