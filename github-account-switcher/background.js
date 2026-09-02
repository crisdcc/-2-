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

// The cookie store of the active tab, when it is a GitHub tab (this makes
// container-aware switching work on desktop); otherwise the default store.
// On Android there is a single store, so this always resolves to undefined.
async function activeGitHubStore() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
    url: ["https://*.github.com/*"],
  });
  const tab = tabs && tabs[0];
  return tab && tab.cookieStoreId ? tab.cookieStoreId : undefined;
}

async function getAllGithubCookies(storeId) {
  const out = [];
  for (const origin of GHAS.SITE_ORIGINS) {
    const opts = { url: origin };
    if (storeId) opts.storeId = storeId;
    out.push(...(await browser.cookies.getAll(opts)));
  }
  return GHAS.dedupeCookies(out.filter(GHAS.cookieAllowed));
}

async function clearGithubCookies(storeId) {
  const victims = await getAllGithubCookies(storeId);
  for (const cookie of victims) {
    const opts = { url: GHAS.cookieUrl(cookie), name: cookie.name };
    if (storeId) opts.storeId = storeId;
    try {
      await browser.cookies.remove(opts);
    } catch (err) {
      // A cookie may already be gone; the restore below is the source of truth.
    }
  }
}

async function applyProfile(profile) {
  const storeId = profile.storeId || undefined;
  await clearGithubCookies(storeId);
  for (const cookie of profile.cookies || []) {
    await browser.cookies.set(GHAS.toSetDetails(cookie));
  }
}

async function reloadGithubTabs() {
  const tabs = await browser.tabs.query({ url: ["https://*.github.com/*"] });
  await Promise.all(
    tabs.map((tab) =>
      browser.tabs.reload(tab.id).catch(() => {
        /* tab closed while switching */
      }),
    ),
  );
  return tabs.length;
}

async function currentAccount() {
  const storeId = await activeGitHubStore();
  try {
    const opts = { url: "https://github.com/", name: "dotcom_user" };
    if (storeId) opts.storeId = storeId;
    const cookie = await browser.cookies.get(opts);
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
      const storeId = await activeGitHubStore();
      const cookies = await getAllGithubCookies(storeId);
      if (!GHAS.usernameFromCookies(cookies)) {
        return { ok: false, error: "no-login" };
      }
      const fresh = GHAS.profileFromCookies(cookies, { storeId: storeId || null });
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
    }

    case "switch": {
      const list = await getProfiles();
      const profile = list.find((p) => p.id === message.id);
      if (!profile) return { ok: false, error: "not-found" };
      await applyProfile(profile);
      const reloaded = await reloadGithubTabs();
      if (reloaded === 0) {
        // No GitHub tab open: land on GitHub so the switched session shows.
        await browser.tabs.create({ url: "https://github.com/" });
      }
      return { ok: true, reloaded: reloaded };
    }

    case "delete": {
      const list = await getProfiles();
      await setProfiles(list.filter((p) => p.id !== message.id));
      return { ok: true };
    }

    case "rename": {
      const name = GHAS.sanitizeName(message.name, 40);
      const list = await getProfiles();
      const profile = list.find((p) => p.id === message.id);
      if (!profile) return { ok: false, error: "not-found" };
      profile.name = name;
      await setProfiles(list);
      return { ok: true, profile: GHAS.profileMeta(profile) };
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
