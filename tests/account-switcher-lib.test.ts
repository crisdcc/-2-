import { describe, expect, it } from "vitest";
import { GHAS } from "../github-account-switcher/lib/hub-lib.mjs";

const GH = GHAS;

function cookie(overrides: Record<string, unknown> = {}) {
  return {
    name: "n",
    value: "v",
    domain: "github.com",
    path: "/",
    secure: true,
    httpOnly: true,
    hostOnly: true,
    session: true,
    sameSite: "lax",
    ...overrides,
  };
}

describe("cookieAllowed", () => {
  it("keeps github.com cookies in any shape", () => {
    expect(GH.cookieAllowed(cookie({ domain: "github.com" }))).toBe(true);
    expect(GH.cookieAllowed(cookie({ domain: ".github.com" }))).toBe(true);
    expect(GH.cookieAllowed(cookie({ domain: "gist.github.com" }))).toBe(true);
    expect(GH.cookieAllowed(cookie({ domain: ".gist.github.com" }))).toBe(true);
  });

  it("drops parent-domain cookies that would match every host", () => {
    expect(GH.cookieAllowed(cookie({ domain: ".com" }))).toBe(false);
    expect(GH.cookieAllowed(cookie({ domain: "example.com" }))).toBe(false);
  });
});

describe("usernameFromCookies", () => {
  it("reads dotcom_user", () => {
    expect(GH.usernameFromCookies([cookie({ name: "dotcom_user", value: "octocat" })])).toBe(
      "octocat",
    );
  });

  it("returns null when nobody is logged in", () => {
    expect(GH.usernameFromCookies([cookie({ name: "logged_in", value: "no" })])).toBeNull();
    expect(GH.usernameFromCookies([])).toBeNull();
  });
});

describe("dedupeCookies", () => {
  it("dedupes by name+domain+path", () => {
    const list = [
      cookie({ name: "a", domain: "github.com", path: "/" }),
      cookie({ name: "a", domain: "github.com", path: "/" }),
      cookie({ name: "a", domain: "github.com", path: "/x" }),
      cookie({ name: "b", domain: ".github.com", path: "/" }),
    ];
    expect(GH.dedupeCookies(list).length).toBe(3);
  });
});

describe("profileFromCookies", () => {
  const logsIn = [
    cookie({ name: "dotcom_user", value: "octocat" }),
    cookie({ name: "user_session", value: "s3cr3t" }),
    cookie({ name: "stray", domain: ".com" }),
  ];

  it("uses the username as a stable id and filters foreign cookies", () => {
    const profile = GH.profileFromCookies(logsIn, { now: 1000 });
    expect(profile.id).toBe("gh-octocat");
    expect(profile.username).toBe("octocat");
    expect(profile.createdAt).toBe(1000);
    expect(profile.updatedAt).toBe(1000);
    expect(profile.cookies.length).toBe(2);
  });

  it("falls back to a timestamped id when not logged in", () => {
    const profile = GH.profileFromCookies([cookie({ name: "logged_in", value: "no" })], {
      now: 42,
    });
    expect(profile.id).toBe("gh-anon-42");
    expect(profile.username).toBeNull();
  });

  it("sanitizes usernames into the id", () => {
    const profile = GH.profileFromCookies([cookie({ name: "dotcom_user", value: "A.B_C!" })]);
    expect(profile.id).toBe("gh-a-b-c-");
  });
});

describe("serializeCookie / toSetDetails roundtrip", () => {
  it("preserves the fields needed to recreate the cookie", () => {
    const serialized = GH.serializeCookie(
      cookie({
        name: "__Host-user_session_same_site",
        value: "abc",
        domain: "github.com",
        path: "/",
        secure: true,
        httpOnly: true,
        hostOnly: true,
        sameSite: "strict",
        expirationDate: 1999999999,
      }),
    );
    expect(serialized).toMatchObject({
      name: "__Host-user_session_same_site",
      value: "abc",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      expirationDate: 1999999999,
      url: "https://github.com/",
    });

    const details = GH.toSetDetails(serialized);
    expect(details.domain).toBeUndefined(); // host-only must stay host-only
    expect(details).toMatchObject({
      url: "https://github.com/",
      name: "__Host-user_session_same_site",
      value: "abc",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      expirationDate: 1999999999,
    });
  });

  it("keeps domain cookies as domain cookies", () => {
    const serialized = GH.serializeCookie(
      cookie({ domain: ".github.com", hostOnly: false, sameSite: "no_restriction" }),
    );
    expect(serialized.url).toBe("https://github.com/");
    expect(GH.toSetDetails(serialized).domain).toBe(".github.com");
  });

  it("restores into the destination store, not the captured one", () => {
    const serialized = GH.serializeCookie(
      cookie({
        name: "user_session",
        value: "x",
        storeId: "firefox-container-1",
      }),
    );
    const details = GH.toSetDetails(serialized, "firefox-container-2");
    expect(details.storeId).toBe("firefox-container-2");
    // Without a destination, no store is written: the captured store is
    // metadata only and is never reused as a restore target.
    expect(GH.toSetDetails(serialized).storeId).toBeUndefined();
  });

  it("preserves firstPartyDomain for first-party isolation", () => {
    const serialized = GH.serializeCookie(
      cookie({ name: "user_session", value: "x", firstPartyDomain: "github.com" }),
    );
    expect(serialized.firstPartyDomain).toBe("github.com");
    expect(GH.toSetDetails(serialized).firstPartyDomain).toBe("github.com");
    // No firstPartyDomain on the source cookie: nothing is written.
    const plain = GH.serializeCookie(cookie({ name: "user_session", value: "x" }));
    expect(plain.firstPartyDomain).toBeUndefined();
    expect(GH.toSetDetails(plain).firstPartyDomain).toBeUndefined();
  });

  it("does not write expirationDate for session cookies", () => {
    const serialized = GH.serializeCookie(cookie({ session: true })); // no expirationDate
    expect(serialized.expirationDate).toBeUndefined();
    expect(GH.toSetDetails(serialized).expirationDate).toBeUndefined();
  });

  it("passes partitionKey through only when partitioned", () => {
    const partitionKey = { topLevelSite: "https://example.com" };
    const serialized = GH.serializeCookie(
      cookie({ partitionKey }),
    );
    expect(GH.toSetDetails(serialized).partitionKey).toEqual(partitionKey);
    expect(GH.toSetDetails(serialized).url).toBe("https://github.com/");
  });
});

describe("misc helpers", () => {
  it("recognizes all github hostnames and rejects lookalikes", () => {
    expect(GH.isGithubHostname("github.com")).toBe(true);
    expect(GH.isGithubHostname("gist.github.com")).toBe(true);
    expect(GH.isGithubHostname("api.github.com")).toBe(true);
    expect(GH.isGithubHostname("notgithub.com")).toBe(false);
    expect(GH.isGithubHostname("github.com.evil.io")).toBe(false);
    expect(GH.isGithubHostname("")).toBe(false);
  });

  it("normalizes sameSite to a value the cookies API accepts", () => {
    expect(GH.normalizeSameSite("strict")).toBe("strict");
    expect(GH.normalizeSameSite("lax")).toBe("lax");
    expect(GH.normalizeSameSite("no_restriction")).toBe("no_restriction");
    expect(GH.normalizeSameSite("unspecified")).toBe("unspecified");
    expect(GH.normalizeSameSite("weird")).toBe("unspecified");
    expect(GH.normalizeSameSite(undefined as unknown as string)).toBe("unspecified");
  });

  it("omits sameSite from restore details when it is unspecified", () => {
    const serialized = GH.serializeCookie(
      cookie({ name: "user_session", value: "x", sameSite: "unspecified" }),
    );
    expect(serialized.sameSite).toBe("unspecified");
    expect(GH.toSetDetails(serialized).sameSite).toBeUndefined();
  });

  it("sanitizes display names", () => {
    expect(GH.sanitizeName("  Работа   аккаунт  ")).toBe("Работа аккаунт");
    expect(GH.sanitizeName("x".repeat(100), 40).length).toBe(40);
    expect(GH.sanitizeName(undefined, 40)).toBe("");
  });

  it("profileMeta never leaks cookie values", () => {
    const profile = GH.profileFromCookies([
      cookie({ name: "dotcom_user", value: "octocat" }),
      cookie({ name: "user_session", value: "s3cr3t" }),
    ]);
    const meta = GH.profileMeta(profile);
    expect("cookies" in meta).toBe(false);
    expect("value" in meta).toBe(false);
    expect(meta.id).toBe(profile.id);
    expect(GH.displayName(meta)).toBe("octocat");
  });
});
