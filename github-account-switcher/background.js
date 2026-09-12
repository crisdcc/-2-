"use strict";
/*
 * GitHub account switcher — background page.
 *
 * All cookie work happens here: capturing a session, clearing github.com
 * cookies and restoring another session, and reloading open GitHub tabs so
 * the switch is visible immediately. The popup only sends messages.
 *
 * Session cookies are the only thing stored (browser.storage.local); the
 * extension never sees or stores passwords.
 */

const STORAGE_KEY = "profiles";

// First-party isolation in Firefox partitions cookies by first-party domain.
// GitHub session cookies live in the github.com jar; when isolation is off,
// Firefox ignores this value, so passing it always is safe.
const GITHUB_FIRST_PARTY_DOMAIN = "github.com";

// The store id of ordinary (non-container) tabs in Firefox.
const DEFAULT_STORE_ID = "firefox-default";

// Profile storage and the cookie store are both read-modify-write: capture,
// switch, delete and rename must not interleave, or a capture could observe a
// half-applied switch and concurrent switches could leave a hybrid session.
let mutationQueue = Promise.resolve();
function enqueue(fn) {
  const run = mutationQueue.then(fn, fn);
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// The lib is an ES module, so the classic background script loads it
// dynamically; every message handler awaits libReady first.
let GHAS = null;
const libReady = import(browser.runtime.getURL("lib/hub-lib.mjs")).then(
  (mod) => {
    GHAS = mod.GHAS;
  },
);

async function getProfiles() {
  const got = await browser.storage.local.get(STORAGE_KEY);
  const list = got[STORAGE_KEY];
  return Array.isArray(list) ? list : [];
}

async function setProfiles(list) {
  await browser.storage.local.set({ [STORAGE_KEY]: list });
}

// The cookie store of the active tab, whatever site it shows. GitHub tabs
// know the store even before a switch; non-GitHub tabs default to the store
// the user is looking at, so a switch lands where the popup was opened.
async function activeTabStore() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  return (tab && tab.cookieStoreId) || DEFAULT_STORE_ID;
}

async function getAllGithubCookies(storeId) {
  const out = [];
  for (const origin of GHAS.SITE_ORIGINS) {
    out.push(
      ...(await browser.cookies.getAll({
        url: origin,
        firstPartyDomain: GITHUB_FIRST_PARTY_DOMAIN,
        storeId: storeId,
      })),
    );
  }
  return GHAS.dedupeCookies(out.filter(GHAS.cookieAllowed));
}

async function removeCookie(opts) {
  try {
    await browser.cookies.remove(opts);
  } catch (err) {
    // Not necessarily a problem: the cookie may have just expired. The
    // re-read below is the source of truth.
  }
  const remaining = await browser.cookies.get(opts);
  if (remaining) {
    throw new Error("Не удалось очистить старую сессию: " + remaining.name);
  }
}

async function clearGithubCookies(storeId) {
  const victims = await getAllGithubCookies(storeId);
  for (const cookie of victims) {
    await removeCookie({
      url: GHAS.cookieUrl(cookie),
      name: cookie.name,
      firstPartyDomain: GITHUB_FIRST_PARTY_DOMAIN,
      storeId: storeId,
    });
  }
}

// Restores the session into `destinationStoreId` — the container the user is
// switching in — never into the store where the session was captured.
async function applyProfile(profile, destinationStoreId) {
  await clearGithubCookies(destinationStoreId);
  for (const cookie of profile.cookies || []) {
    await browser.cookies.set(GHAS.toSetDetails(cookie, destinationStoreId));
  }
}

// Counts successful reloads: a tab that closed mid-switch must not count.
async function reloadGithubTabs(storeId) {
  const tabs = await browser.tabs.query({
    url: ["https://*.github.com/*"],
    cookieStoreId: storeId,
  });
  const results = await Promise.all(
    tabs.map((tab) =>
      browser.tabs.reload(tab.id).then(
        () => true,
        () => false,
      ),
    ),
  );
  return results.filter(Boolean).length;
}

async function currentAccount() {
  const storeId = await activeTabStore();
  try {
    const cookie = await browser.cookies.get({
      url: "https://github.com/",
      name: "dotcom_user",
      firstPartyDomain: GITHUB_FIRST_PARTY_DOMAIN,
      storeId: storeId,
    });
    return cookie && cookie.value ? cookie.value : null;
  } catch (err) {
    return null;
  }
}

async function handle(message) {
  await libReady;
  switch (message.type) {
    case "get-state": {
      const profiles = (await getProfiles()).map(GHAS.profileMeta);
      return {
        ok: true,
        profiles: profiles,
        activeUsername: await currentAccount(),
      };
    }

    case "capture": {
      return enqueue(async () => {
        const storeId = await activeTabStore();
        const cookies = await getAllGithubCookies(storeId);
        if (!GHAS.usernameFromCookies(cookies)) {
          return { ok: false, error: "no-login" };
        }
        const fresh = GHAS.profileFromCookies(cookies, {
          storeId: storeId === DEFAULT_STORE_ID ? null : storeId,
        });
        const list = await getProfiles();
        const idx = list.findIndex((p) => p.id === fresh.id);
        if (idx >= 0) {
          // Re-saving the same account refreshes the session but keeps the
          // custom name and the original creation date.
          fresh.name = list[idx].name;
          fresh.createdAt = list[idx].createdAt;
          list[idx] = fresh;
        } else {
          list.push(fresh);
        }
        await setProfiles(list);
        return { ok: true, profile: GHAS.profileMeta(fresh) };
      });
    }

    case "switch": {
      return enqueue(async () => {
        const list = await getProfiles();
        const profile = list.find((p) => p.id === message.id);
        if (!profile) return { ok: false, error: "not-found" };
        // Switch where the user is looking, not where the session was
        // captured.
        const destinationStoreId = await activeTabStore();
        await applyProfile(profile, destinationStoreId);
        const reloaded = await reloadGithubTabs(destinationStoreId);
        if (reloaded === 0) {
          // No GitHub tab open in that store: land on GitHub so the switched
          // session shows.
          await browser.tabs.create({
            url: "https://github.com/",
            cookieStoreId: destinationStoreId,
          });
        }
        return { ok: true, reloaded: reloaded };
      });
    }

    case "delete": {
      return enqueue(async () => {
        const list = await getProfiles();
        await setProfiles(list.filter((p) => p.id !== message.id));
        return { ok: true };
      });
    }

    case "rename": {
      return enqueue(async () => {
        const name = GHAS.sanitizeName(message.name, 40);
        const list = await getProfiles();
        const profile = list.find((p) => p.id === message.id);
        if (!profile) return { ok: false, error: "not-found" };
        profile.name = name;
        await setProfiles(list);
        return { ok: true, profile: GHAS.profileMeta(profile) };
      });
    }

    default:
      return { ok: false, error: "unknown-message" };
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: String((err && err.message) || err) }),
    );
  return true; // respond asynchronously
});
