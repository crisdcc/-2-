"use strict";
/*
 * Popup UI. Thin shell over the background page: it asks for state, renders
 * the account list and forwards save/switch/delete/rename intents.
 */

const listEl = document.querySelector("#list");
const statusEl = document.querySelector("#status");
const currentLineEl = document.querySelector("#currentLine");

let busy = false;

function send(message) {
  return browser.runtime
    .sendMessage(message)
    .catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
}

function avatarColor(username) {
  const palette = [
    "#238636",
    "#1f6feb",
    "#bf8700",
    "#a371f7",
    "#db61a2",
    "#56d364",
    "#f85149",
    "#58a6ff",
  ];
  let hash = 0;
  for (const ch of String(username || "?")) {
    hash = (hash * 31 + ch.codePointAt(0)) % 997;
  }
  return palette[hash % palette.length];
}

let statusTimer = null;

function showStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", !!ok);
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.hidden = true;
  }, 4000);
}

async function refresh() {
  const state = await send({ type: "get-state" });
  if (!state.ok) {
    showStatus("Не удалось получить состояние: " + state.error);
    return;
  }
  const active = state.activeUsername;
  currentLineEl.replaceChildren();
  const text = document.createTextNode(active ? "Текущий: " : "Сейчас вы не вошли в GitHub");
  currentLineEl.appendChild(text);
  if (active) {
    const strong = document.createElement("strong");
    strong.textContent = "@" + active;
    currentLineEl.appendChild(strong);
  }
  renderList(state.profiles, active);
}

function renderList(profiles, activeUsername) {
  listEl.replaceChildren();
  if (!profiles || profiles.length === 0) {
    listEl.appendChild(emptyState());
    return;
  }
  for (const profile of profiles) {
    listEl.appendChild(profileRow(profile, profile.username === activeUsername));
  }
}

function emptyState() {
  const box = document.createElement("div");
  box.className = "empty";

  const head = document.createElement("b");
  head.textContent = "Как добавить аккаунт";
  box.appendChild(head);

  const ol = document.createElement("ol");
  const step = (parts) => {
    const li = document.createElement("li");
    for (const part of parts) {
      if (part && part.bold) {
        const b = document.createElement("b");
        b.textContent = part.bold;
        li.appendChild(b);
      } else {
        li.appendChild(document.createTextNode(String(part)));
      }
    }
    ol.appendChild(li);
  };
  step(["Откройте github.com и войдите под первым аккаунтом."]);
  step(["Нажмите ", { bold: "＋ Сохранить текущий" }, "."]);
  step(["Войдите под вторым аккаунтом и снова нажмите кнопку."]);
  step(["Теперь тап по аккаунту — GitHub переключится на него."]);
  box.appendChild(ol);
  return box;
}

function makeIconButton(label, tip) {
  const button = document.createElement("button");
  button.className = "icon-btn";
  button.type = "button";
  button.title = tip;
  button.setAttribute("aria-label", tip);
  button.textContent = label;
  return button;
}

function profileRow(profile, isActive) {
  const login = profile.username ? "@" + profile.username : "";
  const title = profile.name || login || profile.id;
  const row = document.createElement("div");
  row.className = "row" + (isActive ? " active" : "");
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.style.background = avatarColor(profile.username || profile.id);
  avatar.textContent = (profile.username || profile.id).slice(0, 1).toUpperCase();

  const body = document.createElement("span");
  body.className = "row-body";
  const titleEl = document.createElement("span");
  titleEl.className = "row-title";
  titleEl.textContent = title;
  body.appendChild(titleEl);
  if (profile.name && login) {
    const sub = document.createElement("span");
    sub.className = "row-sub";
    sub.textContent = login;
    body.appendChild(sub);
  }

  row.appendChild(avatar);
  row.appendChild(body);
  if (isActive) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "активен";
    row.appendChild(badge);
  }

  const editBtn = makeIconButton("✎", "Переименовать");
  const deleteBtn = makeIconButton("✕", "Удалить");
  row.appendChild(editBtn);
  row.appendChild(deleteBtn);

  row.addEventListener("click", (ev) => {
    // Nested buttons and the rename input handle their own events.
    if (ev.target.closest("button, input")) return;
    switchTo(row, profile);
  });
  row.addEventListener("keydown", (ev) => {
    if (ev.target === row && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      switchTo(row, profile);
    }
  });

  editBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    startRename(row, profile);
  });

  deleteBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (row.dataset.confirm === "1") {
      removeProfile(profile.id);
      return;
    }
    row.dataset.confirm = "1";
    deleteBtn.classList.add("armed");
    deleteBtn.textContent = "точно?";
    setTimeout(() => {
      delete row.dataset.confirm;
      deleteBtn.classList.remove("armed");
      deleteBtn.textContent = "✕";
    }, 2500);
  });

  return row;
}

async function switchTo(row, profile) {
  if (busy) return;
  busy = true;
  row.classList.add("switching");
  const res = await send({ type: "switch", id: profile.id });
  busy = false;
  if (res.ok) {
    window.close();
  } else {
    row.classList.remove("switching");
    showStatus("Не удалось переключиться: " + res.error);
  }
}

async function removeProfile(id) {
  if (busy) return;
  busy = true;
  try {
    const res = await send({ type: "delete", id: id });
    if (res.ok) {
      refresh();
    } else {
      showStatus("Не удалось удалить: " + res.error);
    }
  } finally {
    busy = false;
  }
}

function startRename(row, profile) {
  const body = row.querySelector(".row-body");
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = profile.name || "";
  input.placeholder = profile.username ? "@" + profile.username : profile.id;
  body.replaceChildren(input);
  input.focus();
  let committed = false;

  const commit = async () => {
    if (committed) return;
    await withBusy(async () => {
      committed = true;
      const res = await send({ type: "rename", id: profile.id, name: input.value });
      if (res.ok) {
        refresh();
      } else {
        showStatus("Не удалось переименовать: " + res.error);
        refresh();
      }
    });
  };

  input.addEventListener("click", (ev) => ev.stopPropagation());
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") commit();
    if (ev.key === "Escape") refresh();
  });
  input.addEventListener("blur", () => {
    // Defer so a second rename started right after this one is not wiped by
    // the re-render of this blur.
    setTimeout(() => {
      const anotherRename = [...document.querySelectorAll(".rename-input")].some(
        (el) => el !== input,
      );
      if (!committed && !anotherRename) refresh();
    }, 0);
  });
}

// Serialize rename/delete/capture against each other in the popup too; the
// background page serializes the actual storage writes.
async function withBusy(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } finally {
    busy = false;
  }
}

document.querySelector("#openBtn").addEventListener("click", () => {
  browser.tabs.create({ url: "https://github.com/" });
  window.close();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  withBusy(async () => {
    const res = await send({ type: "capture" });
    if (res.ok) {
      showStatus("Сохранён: @" + (res.profile.username || "аккаунт"), true);
      refresh();
    } else if (res.error === "no-login") {
      showStatus("Сначала войдите в GitHub: откройте github.com и войдите под нужным аккаунтом.");
    } else {
      showStatus("Не удалось сохранить: " + res.error);
    }
  });
});

refresh();
