
// --- Design mode was removed from the UI; initialisation is short-circuited here so stale references do not throw ---
﻿"use strict";
const $ = (sel) => document.querySelector(sel);
const state = {
  items: [], characters: [], equips: [], coatingChars: [], stages: [], players: [],
  selected: { player: null, item: null, char: null, equip: null, coating: null, stage: null },
  page: "item",
};
const PAGE_TITLES = {
  item: "Items", character: "Characters", equip: "Equipment",
  coating: "Coatings", scene: "Scene Backgrounds",
  level: "Commandant Level", stage: "Stages",
};
function toast(message, isError = false) {
  const el = $("#toast");
  $("#toastMsg").textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), isError ? 4200 : 2200);
}
function log(text) { $("#respBox").textContent = text; }
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el || el.type !== "number") return;
  if (el.value === "" || Number.isNaN(Number(el.value))) return;
  const min = el.min === "" ? null : Number(el.min);
  const max = el.max === "" ? null : Number(el.max);
  let v = Math.floor(Number(el.value));
  if (!Number.isFinite(v)) return;
  if (min !== null && v < min) v = min;
  if (max !== null && v > max) v = max;
  if (String(v) !== el.value) {
    el.value = String(v);
    toast(`Value clamped to ${min ?? "-∞"} ~ ${max ?? "∞"}`);
  }
  refreshPreview();
});
document.addEventListener("input", (e) => {
  if (e.target && ["itemQty", "levelValue"].includes(e.target.id)) refreshPreview();
});
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}
async function exec(command, args) {
  try {
    await SelenaAPI.ensureAccount();
  } catch (err) {
    toast("Log in first", true);
    return;
  }
  log("Sending…");
  try {
    const res = await SelenaAPI.command(command, args);
    log(JSON.stringify(res, null, 2));
    toast((res && res.msg) || "Done");
  } catch (err) {
    log(String(err.message || err));
    toast((err && err.message) || "Request failed", true);
  }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Command copied"); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove(); toast("Command copied");
  }
}
function primaryCommand() {
  switch (state.page) {
    case "item": {
      const it = state.selected.item;
      if (!it) return null;
      const qty = ($("#itemQty").value || "1").trim();
      return { command: "item", args: ["add", String(it.id), qty] };
    }
    case "character": {
      const it = state.selected.char;
      return it ? { command: "character", args: ["add", String(it.id)] } : null;
    }
    case "equip": {
      const it = state.selected.equip;
      return it ? { command: "equip", args: ["add", String(it.id)] } : null;
    }
    case "coating": {
      const it = state.selected.coating;
      return it ? { command: "coating", args: ["unlock", String(it.id)] } : null;
    }
    case "level": {
      const v = ($("#levelValue").value || "").trim();
      return v ? { command: "level", args: [v] } : null;
    }
    case "stage": {
      const it = state.selected.stage;
      return it ? { command: "stage", args: [String(it.id)] } : null;
    }
    case "scene":
      return { command: "scene", args: ["unlock", "all"] };
  }
  return null;
}
function refreshPreview() {
  const cmd = primaryCommand();
  const el = $("#cmdPreview");
  if (!cmd) { el.textContent = "—"; el.classList.remove("is-ready"); return; }
  el.textContent = `/${cmd.command} ${cmd.args.join(" ")}`;
  el.classList.add("is-ready");
}
const SS_RENDER_LIMIT = 60;
class SearchSelect {
  constructor(container, opts = {}) {
    this.opts = Object.assign(
      { placeholder: "Search…", getLabel: (it) => String(it), getSub: null, getSearch: null, onSelect: null },
      opts
    );
    this.items = []; this.selected = null; this.activeIndex = -1; this.matched = [];
    container.classList.add("ss-root");
    container.innerHTML = `
      <input class="ss-input" type="text" placeholder="${this.opts.placeholder}" autocomplete="off" readonly />
      <button class="ss-search-btn" type="button" title="Search">🔍</button>
      <div class="ss-dropdown"></div>`;
    this.container = container;
    this.input = container.querySelector(".ss-input");
    this.dropdown = container.querySelector(".ss-dropdown");
    this.searchBtn = container.querySelector(".ss-search-btn");
    // Mobile WebView: focusing an input pops the keyboard and pushes the list away.
    // Read-only by default; a tap only expands the list. The search button enables real search (typing allowed).
    this.searchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.input.removeAttribute("readonly");
      this.input.focus();
      this.open();
    });
    this.input.addEventListener("focus", () => this.open());
    this.input.addEventListener("pointerdown", () => {
      if (this.isOpen) return;
      if (this.selected || this.input.value) {
        this.selected = null; this.input.value = "";
        this.input.classList.remove("ss-input--filled"); this.activeIndex = -1;
        if (this.opts.onSelect) this.opts.onSelect(null);
      }
      this.open();
    });
    this.input.addEventListener("input", () => {
      this.selected = null; this.input.classList.remove("ss-input--filled"); this.activeIndex = -1;
      this.open();
      if (this.opts.onSelect) this.opts.onSelect(null);
    });
    this.input.addEventListener("keydown", (e) => this.onKeydown(e));
    this.input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    document.addEventListener("pointerdown", (e) => { if (!container.contains(e.target)) this.close(); });
  }
  setItems(items) { this.items = items; this.select(null); }
  select(item) {
    this.selected = item;
    if (item) { this.input.value = this.opts.getLabel(item); this.input.classList.add("ss-input--filled"); }
    else this.input.classList.remove("ss-input--filled");
    this.close();
    if (this.opts.onSelect) this.opts.onSelect(item);
  }
  open() { this.renderOptions(); this.dropdown.classList.add("is-open"); }
  close() {
    this.dropdown.classList.remove("is-open");
    // Collapsing leaves search mode so the keyboard does not pop up again on the next tap
    if (this.dropdown.dataset.keepOpen !== "1") {
      this.input.setAttribute("readonly", "");
      if (document.activeElement === this.input) this.input.blur();
    }
  }
  get isOpen() { return this.dropdown.classList.contains("is-open"); }
  filter() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) return this.items;
    const gs = this.opts.getSearch || ((it) => String(it).toLowerCase());
    return this.items.filter((it) => gs(it).includes(q));
  }
  renderOptions() {
    this.matched = this.filter();
    const shown = this.matched.slice(0, SS_RENDER_LIMIT);
    this.dropdown.innerHTML = "";
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "ss-empty"; empty.textContent = "No matches";
      this.dropdown.appendChild(empty); return;
    }
    shown.forEach((item) => {
      const row = document.createElement("div");
      row.className = "ss-option";
      const main = document.createElement("div");
      main.className = "ss-option__main"; main.textContent = this.opts.getLabel(item);
      row.appendChild(main);
      if (this.opts.getSub) {
        const sub = document.createElement("div");
        sub.className = "ss-option__sub"; sub.textContent = this.opts.getSub(item);
        row.appendChild(sub);
      }
      // pointerdown selects the instant the finger lands, which makes the list impossible to scroll.
      // Use click instead: browsers only fire it on press+release with no scroll in between.
      row.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.select(item); });
      this.dropdown.appendChild(row);
    });
    if (this.matched.length > shown.length) {
      const more = document.createElement("div");
      more.className = "ss-more"; more.textContent = `${this.matched.length} entries - type to narrow down…`;
      this.dropdown.appendChild(more);
    }
  }
  onKeydown(e) {
    if (!this.isOpen) { if (e.key === "ArrowDown" || e.key === "Enter") this.open(); return; }
    const rows = this.dropdown.querySelectorAll(".ss-option");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = e.key === "ArrowDown"
        ? Math.min(this.activeIndex + 1, rows.length - 1)
        : Math.max(this.activeIndex - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === this.activeIndex));
      if (rows[this.activeIndex]) rows[this.activeIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = this.matched[this.activeIndex] ?? this.matched[0];
      if (item) this.select(item);
    } else if (e.key === "Escape") { this.close(); }
  }
}

class SplitSelect {
  constructor(inputSel, boxSel, opts) {
    this.input = $(inputSel);
    this.box = $(boxSel);
    this.opts = Object.assign({
      getLabel: (it) => String(it),
      getSearch: (it) => String(it).toLowerCase(),
      onSelect: null,
    }, opts);
    this.items = [];
    this.value = null;
    this.matched = [];
    this.isOpen = false;
    this.label = this.box.querySelector(".split__value");
    this.dropdown = this.box.querySelector(".split__dropdown");
    this.input.addEventListener("input", () => { this.render(); this.open(); });
    this.box.addEventListener("click", (e) => {
      if (e.target.closest(".split__dropdown")) return;
      if (this.isOpen) this.close(); else this.open();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.box.contains(e.target) && e.target !== this.input) this.close();
    });
  }
  setItems(items) {
    this.items = items;
    this.value = null;
    this.input.value = "";
    this.render();
  }
  render() {
    const q = this.input.value.trim().toLowerCase();
    this.matched = q ? this.items.filter((it) => this.opts.getSearch(it).includes(q)) : this.items;
    const shown = this.matched.slice(0, 300);
    const keep = this.value ? String(this.value.id) : "";
    if (this.value && !this.matched.some((it) => String(it.id) === keep)) {
      this.value = null;
      if (this.opts.onSelect) this.opts.onSelect(null);
    }
    if (this.value) {
      this.label.textContent = this.opts.getLabel(this.value);
      this.label.classList.remove("is-empty");
    } else {
      this.label.textContent = q ? `${this.matched.length} matches` : `${this.items.length} entries`;
      this.label.classList.add("is-empty");
    }
    this.dropdown.innerHTML = "";
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "ss-empty";
      empty.textContent = "No matches";
      this.dropdown.appendChild(empty);
      return;
    }
    shown.forEach((it) => {
      const row = document.createElement("div");
      row.className = "ss-option";
      const main = document.createElement("div");
      main.className = "ss-option__main";
      main.textContent = this.opts.getLabel(it);
      row.appendChild(main);
      row.addEventListener("click", (ev) => { ev.stopPropagation(); this.select(it); });
      this.dropdown.appendChild(row);
    });
    if (this.matched.length > shown.length) {
      const more = document.createElement("div");
      more.className = "ss-more";
      more.textContent = `${this.matched.length} entries - keep typing to narrow down…`;
      this.dropdown.appendChild(more);
    }
  }
  select(it) {
    this.value = it;
    this.render();
    this.close();
    if (this.opts.onSelect) this.opts.onSelect(it);
  }
  open() { this.render(); this.box.classList.add("is-open"); this.isOpen = true; }
  close() { this.box.classList.remove("is-open"); this.isOpen = false; }
}
const nameIdLabel = (it) => `${it.name} · ${it.id}`;
const nameIdSearch = (it) => `${it.name} ${it.id}`.toLowerCase();
function navigate() {
  let page = location.hash.replace(/^#\/?/, "") || "item";
  if (!PAGE_TITLES[page]) page = "item";
  state.page = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("is-active", p.id === `page-${page}`));
  document.querySelectorAll(".nav__item").forEach((a) => a.classList.toggle("is-active", a.dataset.page === page));
  $("#pageTitle").textContent = PAGE_TITLES[page];
  refreshPreview();
}
let ssPlayer, ssItem, ssChar, ssEquip, ssCoating, ssStage;
async function loadData() {
  const [items, characters, equips, stages] = await Promise.all([
    SelenaAPI.catalog("items"),
    SelenaAPI.catalog("characters"),
    SelenaAPI.catalog("equips"),
    SelenaAPI.catalog("stages"),
  ]);
  state.items = items;
  state.characters = characters;
  state.equips = equips;
  state.coatingChars = characters.slice();
  state.stages = stages;
  ssItem.setItems(state.items);
  ssChar.setItems(state.characters);
  ssEquip.setItems(state.equips);
  ssCoating.setItems(state.coatingChars);
  ssStage.setItems(state.stages);
  toast(`Catalog loaded: items ${state.items.length} · characters ${state.characters.length} · equipment ${state.equips.length} · stages ${state.stages.length}`);
}
async function loadPlayers() {
  const dot = $("#connStatus"); const txt = $("#connText");
  let acc;
  try {
    acc = await SelenaAPI.ensureAccount();
  } catch (err) {
    dot.classList.remove("is-online");
    txt.textContent = "Not logged in";
    return;
  }
  // The command API acts on the account behind the token, so the only valid
  // target is the account itself. Acting on another player needs a server-side
  // admin endpoint (stage B).
  state.players = [{ uid: acc.uid, name: acc.username, online: true }];
  ssPlayer.setItems(state.players);
  ssPlayer.select(state.players[0]);
  dot.classList.add("is-online");
  txt.textContent = `Online: ${acc.username} (UID ${acc.uid})`;
}
function buildSelects() {
  ssPlayer = new SearchSelect($("#playerSelect"), {
    placeholder: "Select player…",
    getLabel: (p) => `${p.name} · ${p.uid}`,
    getSearch: (p) => `${p.name} ${p.uid}`.toLowerCase(),
    onSelect: (p) => { state.selected.player = p; },
  });
  ssItem = new SplitSelect("#itemSearch", "#itemSelect", {
    getLabel: nameIdLabel, getSearch: nameIdSearch,
    onSelect: (it) => { state.selected.item = it; $("#itemQty").max = it ? String(it.maxCount) : ""; refreshPreview(); },
  });
  ssChar = new SplitSelect("#charSearch", "#charSelect", {
    getLabel: nameIdLabel, getSearch: nameIdSearch,
    onSelect: (it) => { state.selected.char = it; refreshPreview(); },
  });
  ssEquip = new SplitSelect("#equipSearch", "#equipSelect", {
    getLabel: nameIdLabel, getSearch: nameIdSearch,
    onSelect: (it) => { state.selected.equip = it; refreshPreview(); },
  });
  ssCoating = new SearchSelect($("#coatingSelect"), {
    placeholder: "Search character name or ID…", getLabel: nameIdLabel, getSearch: nameIdSearch,
    onSelect: (it) => { state.selected.coating = it; refreshPreview(); },
  });
  ssStage = new SplitSelect("#stageSearch", "#stageSelect", {
    getLabel: nameIdLabel, getSearch: nameIdSearch,
    onSelect: (it) => { state.selected.stage = it; refreshPreview(); },
  });
}

/* * Inserts an Execute button to the right of each page's "Select ..." panel title.
 * Tapping it runs the page's primary command directly, so there is no need to scroll
 * down to the global Execute button at the bottom.
 */
function installPanelExecButtons() {
  document.querySelectorAll(".page").forEach((page) => {
    const head = page.querySelector(".panel__head");
    if (!head || head.querySelector(".panel-exec")) return;
    const pageId = page.id.replace(/^page-/, "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-exec";
    btn.textContent = "Execute";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const previous = state.page;
      state.page = pageId;              // primaryCommand() depends on the current page
      const cmd = primaryCommand();
      state.page = previous;
      if (!cmd) { toast("Select a target first", true); return; }
      exec(cmd.command, cmd.args);
    });
    head.appendChild(btn);
  });
}

function bindActions() {
  $("#refreshPlayers").addEventListener("click", () => loadPlayers());
  $("#clearLog").addEventListener("click", () => log("Waiting for a command…"));
  window.addEventListener("hashchange", navigate);
  $("#cmdExec").addEventListener("click", () => {
    const cmd = primaryCommand();
    if (!cmd) { toast("Select a target on this page first", true); return; }
    exec(cmd.command, cmd.args);
  });
  $("#cmdCopy").addEventListener("click", () => {
    const cmd = primaryCommand();
    if (!cmd) { toast("No command to copy right now", true); return; }
    copyText(`/${cmd.command} ${cmd.args.join(" ")}`);
  });
  $("#itemMaxBtn").addEventListener("click", () => {
    const it = state.selected.item;
    if (!it) { toast("Select an item first", true); return; }
    $("#itemQty").value = String(it.maxCount); refreshPreview();
  });
  $("#itemAddAll").addEventListener("click", () => exec("item", ["add", "all", ($("#itemQty").value || "max").trim()]));
  $("#itemReset").addEventListener("click", () => { if (confirm("Reset this player's inventory to the default items?")) exec("item", ["reset"]); });
  $("#charAddAll").addEventListener("click", () => exec("character", ["add", "all"]));
  $("#equipAddAll").addEventListener("click", () => exec("equip", ["add", "all"]));
  $("#equipPrune").addEventListener("click", () => exec("equip", ["prune"]));
  $("#equipSync").addEventListener("click", () => exec("equip", ["sync"]));
  $("#coatingUnlockAll").addEventListener("click", () => exec("coating", ["unlock", "all"]));
  $("#sceneUnlockAll").addEventListener("click", () => exec("scene", ["unlock", "all"]));
  $("#levelMaxBtn").addEventListener("click", () => exec("level", ["max"]));
  $("#stageAll").addEventListener("click", () => exec("stage", ["all"]));
}

// ---- Visual design mode ---------------------------------------------------
// This is deliberately client-side: it changes presentation only and never
// touches the GM command/API pipeline.  Styles are persisted per browser so a
// layout can be tried safely before being copied into the source CSS.
const DESIGN_STORE = "pgr.gm.design.v1";
const DESIGN_FIELDS = {
  text: "designText", color: "designColor", backgroundColor: "designBg",
  fontSize: "designFontSize", borderRadius: "designRadius", padding: "designPadding",
  width: "designWidth", height: "designHeight",
};
const DESIGN_STYLE_PROPS = {
  color: "color", backgroundColor: "backgroundColor", fontSize: "fontSize",
  borderRadius: "borderRadius", padding: "padding", width: "width", height: "height",
};
let designMode = false;
let designTarget = null;
let designModel = {};
let designDrag = null;

function designReadStore() {
  try { designModel = JSON.parse(localStorage.getItem(DESIGN_STORE) || "{}"); }
  catch { designModel = {}; }
}
function designWriteStore() {
  localStorage.setItem(DESIGN_STORE, JSON.stringify(designModel));
}
function designSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let node = el;
  while (node && node !== document.body && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    if (node.classList.length) part += [...node.classList].filter(c => !c.startsWith("design-")).slice(0, 2).map(c => `.${CSS.escape(c)}`).join("");
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => c.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}
function designSelectable(el) {
  if (!el || !(el instanceof HTMLElement) || el.closest("[data-design-ui]")) return null;
  if (el === document.body || el === document.documentElement || el.id === "toast") return null;
  return el;
}
function designApplyRecord(el, record) {
  if (!el || !record) return;
  const s = record.styles || {};
  Object.entries(DESIGN_STYLE_PROPS).forEach(([key, prop]) => {
    if (s[key] !== undefined) el.style[prop] = s[key];
  });
  if (s.left !== undefined || s.top !== undefined) {
    el.style.position = "relative";
    if (s.left !== undefined) el.style.left = s.left;
    if (s.top !== undefined) el.style.top = s.top;
  }
  if (record.text !== undefined && el.children.length === 0) el.textContent = record.text;
}
function designApplyAll() {
  Object.entries(designModel).forEach(([selector, record]) => {
    try { designApplyRecord(document.querySelector(selector), record); } catch {}
  });
}
function designRecordFor(el) {
  const selector = designSelector(el);
  if (!selector) return null;
  if (!designModel[selector]) designModel[selector] = { styles: {} };
  return designModel[selector];
}
function designColor(value, fallback) {
  const probe = document.createElement("span");
  probe.style.color = value;
  if (!probe.style.color) return fallback;
  const match = probe.style.color.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/i);
  return match ? `#${[match[1], match[2], match[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("")}` : (value.startsWith("#") ? value : fallback);
}
function designSyncFields() {
  if (!designTarget) return;
  const record = designRecordFor(designTarget);
  const computed = getComputedStyle(designTarget);
  const set = (id, value) => { const el = $(`#${id}`); if (el) el.value = value ?? ""; };
  set(DESIGN_FIELDS.text, designTarget.children.length ? "" : (record.text ?? designTarget.textContent.trim()));
  set(DESIGN_FIELDS.color, designColor(record.styles.color || computed.color, "#ffffff"));
  set(DESIGN_FIELDS.backgroundColor, designColor(record.styles.backgroundColor || computed.backgroundColor, "#101114"));
  set(DESIGN_FIELDS.fontSize, parseFloat(record.styles.fontSize || computed.fontSize) || "");
  set(DESIGN_FIELDS.borderRadius, parseFloat(record.styles.borderRadius || computed.borderRadius) || 0);
  set(DESIGN_FIELDS.padding, record.styles.padding || computed.padding);
  set(DESIGN_FIELDS.width, record.styles.width || (computed.width === "auto" ? "" : computed.width));
  set(DESIGN_FIELDS.height, record.styles.height || (computed.height === "auto" ? "" : computed.height));
}
function designSelect(el) {
  designTarget = designSelectable(el);
  document.querySelectorAll(".design-selected").forEach(node => node.classList.remove("design-selected"));
  if (!designTarget) return;
  designTarget.classList.add("design-selected");
  const label = $("#designSelection");
  if (label) label.textContent = `${designTarget.tagName.toLowerCase()}${designTarget.id ? `#${designTarget.id}` : ""}`;
  designSyncFields();
}
function designLiveApply() {
  if (!designTarget) return;
  const record = designRecordFor(designTarget);
  const text = $(`#${DESIGN_FIELDS.text}`).value;
  if (designTarget.children.length === 0 && text !== "") { record.text = text; designTarget.textContent = text; }
  Object.entries(DESIGN_STYLE_PROPS).forEach(([key, prop]) => {
    const input = $(`#${DESIGN_FIELDS[key]}`);
    if (!input || input.value === "") return;
    const value = key === "fontSize" || key === "borderRadius" ? `${input.value}px` : input.value;
    record.styles[key] = value;
    designTarget.style[prop] = value;
  });
  designWriteStore();
}
function designReset() {
  if (!confirm("Restore the default GM layout? This only clears visual tweaks saved in this browser.")) return;
  localStorage.removeItem(DESIGN_STORE); designModel = {};
  location.reload();
}
function designExport() {
  const blob = new Blob([JSON.stringify(designModel, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "pgr-gm-design.json"; a.click(); URL.revokeObjectURL(url);
  toast("Style exported");
}
function designSetMode(value) {
  designMode = value;
  document.body.classList.toggle("design-mode", value);
  const dock = $("#designDock");
  dock.hidden = !value; dock.setAttribute("aria-hidden", String(!value));
  $("#designModeBtn").classList.toggle("is-active", value);
  if (!value) designSelect(null);
}
function initDesignMode() {
  designReadStore(); designApplyAll();
  /* removed */ void (0) && (null).addEventListener("click", () => designSetMode(!designMode));
  $("#designClose").addEventListener("click", () => designSetMode(false));
  $("#designReset").addEventListener("click", designReset);
  $("#designExport").addEventListener("click", designExport);
  $("#designSave").addEventListener("click", () => { designWriteStore(); toast("Saved to this browser"); });
  Object.values(DESIGN_FIELDS).forEach(id => $("#" + id).addEventListener("input", designLiveApply));
  document.addEventListener("click", event => {
    if (!designMode || event.target.closest("[data-design-ui]")) return;
    const target = designSelectable(event.target);
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); designSelect(target);
  }, true);
  document.addEventListener("pointerdown", event => {
    if (!designMode || !designTarget || event.target.closest("[data-design-ui]") || !designTarget.contains(event.target)) return;
    designDrag = { x: event.clientX, y: event.clientY, left: parseFloat(getComputedStyle(designTarget).left) || 0, top: parseFloat(getComputedStyle(designTarget).top) || 0 };
    designTarget.style.position = "relative"; designTarget.setPointerCapture?.(event.pointerId); event.preventDefault();
  }, true);
  document.addEventListener("pointermove", event => {
    if (!designDrag || !designTarget) return;
    designTarget.style.left = `${designDrag.left + event.clientX - designDrag.x}px`;
    designTarget.style.top = `${designDrag.top + event.clientY - designDrag.y}px`;
  }, true);
  document.addEventListener("pointerup", () => {
    if (!designDrag || !designTarget) return;
    const record = designRecordFor(designTarget); record.styles.left = designTarget.style.left; record.styles.top = designTarget.style.top;
    designWriteStore(); designDrag = null;
  }, true);
}
async function main() {
  buildSelects();
  installPanelExecButtons();
  bindActions();
  // Design mode was removed from the UI; initDesignMode() is no longer called,
  // otherwise #designDock is null and throws, which stops loadData() from running (all dropdowns end up empty).
  navigate();
  try { await Promise.all([loadData(), loadPlayers()]); }
  catch (err) { toast(`Initialization failed: ${err.message || err}`, true); log(String(err)); }
}
document.addEventListener("DOMContentLoaded", main);
