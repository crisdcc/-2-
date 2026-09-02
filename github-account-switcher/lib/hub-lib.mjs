/*
 * Pure logic for the GitHub account switcher. No browser APIs here: the
 * background page imports this module, and vitest imports the same file.
 */

"use strict";

// Origins whose session cookies belong to a GitHub account.
const SITE_ORIGINS = [
  "https://github.com",
  "https://gist.github.com",
  "https://api.github.com",
];

function isGithubHostname(hostname) {
  return hostname === "github.com" || hostname.endsWith(".github.com");
}

// GitHub sets account-session cookies on github.com subdomains only.
// A cookie with parent domain ".com" would match every host and must not
// be captured or restored.
function cookieAllowed(cookie) {
  return (
    cookie.domain === "github.com" || cookie.domain.endsWith(".github.com")
  );
}

function cookieKey(cookie) {
  return cookie.name + "|" + cookie.domain + "|" + cookie.path;
}

function dedupeCookies(cookies) {
  const seen = new Set();
  const out = [];
  for (const cookie of cookies) {
    const key = cookieKey(cookie);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cookie);
    }
  }
  return out;
}

function normalizeSameSite(value) {
  return value === "strict" || value === "lax" || value === "no_restriction"
    ? value
    : "no_restriction";
}

// URL that the stored cookie belongs to (used for browser.cookies.set and
// browser.cookies.remove).
function cookieUrl(cookie) {
  return "https://" + cookie.domain.replace(/^\./, "") + cookie.path;
}

function serializeCookie(cookie) {
  const out = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    hostOnly: !!cookie.hostOnly,
    sameSite: normalizeSameSite(cookie.sameSite),
    url: cookieUrl(cookie),
  };
  if (cookie.expirationDate) out.expirationDate = cookie.expirationDate;
  if (cookie.storeId) out.storeId = cookie.storeId;
  if (cookie.partitionKey && cookie.partitionKey.topLevelSite) {
    out.partitionKey = cookie.partitionKey;
  }
  return out;
}

// Arguments for browser.cookies.set(). Host-only cookies (including all
// __Host-* cookies) must be recreated without a `domain`, otherwise the
// browser turns them into domain cookies and GitHub rejects the session.
function toSetDetails(cookie) {
  const details = {
    url: cookie.url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
  if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey && cookie.partitionKey.topLevelSite) {
    details.partitionKey = cookie.partitionKey;
  }
  return details;
}

function usernameFromCookies(cookies) {
  const hit = cookies.find((cookie) => cookie.name === "dotcom_user");
  return hit && hit.value ? hit.value : null;
}

function sanitizeName(value, maxLen) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLen || 40);
}

function makeId(username, stamp) {
  const base = username
    ? String(username).toLowerCase().replace(/[^a-z0-9-]/g, "-")
    : "anon";
  return "gh-" + base + (username ? "" : "-" + (stamp || Date.now()));
}

function profileFromCookies(cookies, opts) {
  const o = opts || {};
  const allowed = dedupeCookies(cookies.filter(cookieAllowed));
  const username = o.username || usernameFromCookies(allowed);
  const now = o.now || Date.now();
  return {
    id: o.existingId || makeId(username, now),
    username: username,
    name: o.name ? sanitizeName(o.name) : "",
    createdAt: o.createdAt || now,
    updatedAt: now,
    storeId: o.storeId || null,
    partitionKey: o.partitionKey || null,
    cookies: allowed.map(serializeCookie),
  };
}

// What the popup needs to see; cookie values never leave the background page
// once stored, so profileMeta intentionally drops them.
function profileMeta(profile) {
  return {
    id: profile.id,
    username: profile.username,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    storeId: profile.storeId,
  };
}

function displayName(profile) {
  return profile.name || profile.username || profile.id;
}

const GHAS = {
  SITE_ORIGINS,
  isGithubHostname,
  cookieAllowed,
  dedupeCookies,
  normalizeSameSite,
  cookieUrl,
  serializeCookie,
  toSetDetails,
  usernameFromCookies,
  sanitizeName,
  makeId,
  profileFromCookies,
  profileMeta,
  displayName,
};

export { GHAS };
