import { describe, expect, test } from "bun:test";
import { resolvePrivacyMap, isRepoVisible, visibleRepoKeys, uncoveredRepos } from "../../src/privacy/privacy";
import type { RepositoryIdentity } from "../../src/shared/types";

function repo(repoKey: string, isPrivate: boolean | null): RepositoryIdentity {
  return {
    repoKey,
    name: repoKey.split("/").pop() ?? repoKey,
    localPath: null,
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    source: "github",
    isPrivate,
    present: true,
    lastSeenAt: null,
  };
}

describe("privacy — fail-closed tri-state contract", () => {
  test("unknown (null) privacy resolves to private in the map", () => {
    const map = resolvePrivacyMap([repo("github:a/b", null)]);
    expect(map["github:a/b"]).toBe(true);
  });

  test("confirmed public stays public", () => {
    const map = resolvePrivacyMap([repo("github:a/b", false)]);
    expect(map["github:a/b"]).toBe(false);
  });

  test("confirmed private stays private", () => {
    const map = resolvePrivacyMap([repo("github:a/b", true)]);
    expect(map["github:a/b"]).toBe(true);
  });

  test("missing map entry is treated as private (hidden) by default", () => {
    expect(isRepoVisible("github:unknown/repo", {}, false)).toBe(false);
  });

  test("opt-in disabled hides private and unknown", () => {
    const map = resolvePrivacyMap([repo("github:pub/x", false), repo("github:priv/y", true), repo("github:unk/z", null)]);
    expect(isRepoVisible("github:pub/x", map, false)).toBe(true);
    expect(isRepoVisible("github:priv/y", map, false)).toBe(false);
    expect(isRepoVisible("github:unk/z", map, false)).toBe(false);
  });

  test("opt-in enabled shows everything known", () => {
    const map = resolvePrivacyMap([repo("github:priv/y", true), repo("github:unk/z", null)]);
    expect(isRepoVisible("github:priv/y", map, true)).toBe(true);
    expect(isRepoVisible("github:unk/z", map, true)).toBe(true);
  });

  test("visibleRepoKeys computes the explicit-public-only inverse set", () => {
    const map = resolvePrivacyMap([repo("github:pub/x", false), repo("github:priv/y", true), repo("github:unk/z", null)]);
    const visible = visibleRepoKeys(map, false);
    expect(visible.has("github:pub/x")).toBe(true);
    expect(visible.has("github:priv/y")).toBe(false);
    expect(visible.has("github:unk/z")).toBe(false);
  });

  test("uncoveredRepos counts repos missing from the map (names never surfaced)", () => {
    const repos = [repo("github:a/b", false), repo("github:c/d", null)];
    const map = resolvePrivacyMap([repo("github:a/b", false)]); // c/d missing
    expect(uncoveredRepos(repos, map)).toBe(1);
  });

  test("privacy filtering is deterministic", () => {
    const map = resolvePrivacyMap([repo("github:a/b", false), repo("github:a/c", true)]);
    expect(visibleRepoKeys(map, false)).toEqual(new Set(["github:a/b"]));
  });
});
