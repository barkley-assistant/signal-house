import { describe, expect, it } from "vitest";
import { resolveSectionState } from "../resolve-state";

describe("resolveSectionState", () => {
  it("returns loading when isLoading is true", () => {
    expect(
      resolveSectionState({
        isLoading: true,
        error: null,
        isEmpty: false,
      })
    ).toBe("loading");
  });

  it("returns loading even if there is an error", () => {
    expect(
      resolveSectionState({
        isLoading: true,
        error: "some error",
        isEmpty: false,
      })
    ).toBe("loading");
  });

  it("returns unavailable when error and isUnconfigured", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: "not configured",
        isEmpty: false,
        isUnconfigured: true,
      })
    ).toBe("unavailable");
  });

  it("returns error when there is an error and not unconfigured", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: "something broke",
        isEmpty: false,
      })
    ).toBe("error");
  });

  it("returns empty when no error and isEmpty", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: true,
      })
    ).toBe("empty");
  });

  it("returns stale when isStale", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: false,
        isStale: true,
      })
    ).toBe("stale");
  });

  it("returns partial when isPartial", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: false,
        isPartial: true,
      })
    ).toBe("partial");
  });

  it("returns data-available when all conditions are false", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: false,
      })
    ).toBe("data-available");
  });

  it("prioritizes loading over all other states", () => {
    expect(
      resolveSectionState({
        isLoading: true,
        error: "error",
        isEmpty: true,
        isStale: true,
        isPartial: true,
        isUnconfigured: true,
      })
    ).toBe("loading");
  });

  it("prioritizes unavailable over error", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: "error",
        isEmpty: true,
        isUnconfigured: true,
      })
    ).toBe("unavailable");
  });

  it("prioritizes error over empty", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: "error",
        isEmpty: true,
      })
    ).toBe("error");
  });

  it("prioritizes empty over stale", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: true,
        isStale: true,
      })
    ).toBe("empty");
  });

  it("prioritizes stale over partial", () => {
    expect(
      resolveSectionState({
        isLoading: false,
        error: null,
        isEmpty: false,
        isStale: true,
        isPartial: true,
      })
    ).toBe("stale");
  });
});
