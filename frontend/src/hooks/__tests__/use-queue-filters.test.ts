import { loadFilter } from "@/hooks/useQueueFilters";

const originalWindow = (globalThis as Record<string, unknown>).window;

afterAll(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeWindowWithSession(): void {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    },
  } as unknown as Window & typeof globalThis;
}

describe("loadFilter", () => {
  it("returns fallback when window is undefined (SSR)", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(loadFilter("k", "a", ["a", "b", "c"] as const)).toBe("a");
  });

  it("returns fallback when sessionStorage is empty", () => {
    makeWindowWithSession();
    expect(loadFilter("sh-queue-type", "all", ["all", "issues", "prs"] as const)).toBe("all");
  });

  it("returns the stored value when valid", () => {
    makeWindowWithSession();
    (globalThis.window as unknown as { sessionStorage: Storage }).sessionStorage.setItem("sh-queue-type", "issues");
    expect(loadFilter("sh-queue-type", "all", ["all", "issues", "prs"] as const)).toBe("issues");
  });

  it("falls back to default when stored value is not in allowed set", () => {
    makeWindowWithSession();
    (globalThis.window as unknown as { sessionStorage: Storage }).sessionStorage.setItem("sh-queue-type", "bogus");
    expect(loadFilter("sh-queue-type", "all", ["all", "issues", "prs"] as const)).toBe("all");
  });

  it("falls back to default when sessionStorage throws", () => {
    makeWindowWithSession();
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadFilter("sh-queue-type", "all", ["all", "issues", "prs"] as const)).toBe("all");
  });
});
