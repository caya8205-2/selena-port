/* Selena-port player page.
 *
 * Grants to the acting account through the same AscNet commands the GM page and the in-game
 * `/help` use. The account is picked from the server database, not from a sign-in: the panel
 * posts to /api/panel/command/<name> with that uid, and the server serves it from the live
 * session when the player is in game or from an offline session over the same documents.
 */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  // The server reads a memory resonance pool from the request's Type, so the type has to travel with
  // the pick instead of being read off the slot position. Both slots list the same four stat picks and
  // the upper list also carries the construct's skills, so "slot 1 means attrib" refused every skill
  // chosen on the upper slot with "resonance N is not in slot 1". Picker entries carry their own kind
  // and a stored resonance carries its Type, so both fill this map and Perform reads it.
  var RESONANCE_KINDS = new Map();

  var SECTIONS = {
    items: {
      title: "Items",
      command: "item",
      bulkAmount: "qty",
      fields: [
        { key: "item", type: "combo", catalog: "items", label: "Item", placeholder: "Search item name or ID", required: true },
        { key: "qty", type: "number", label: "Amount", value: "1", min: 1, max: 999999999, hint: "server clamps to the item limit" }
      ],
      build: function (v) { return ["add", v.item.id, v.qty]; },
      allArgs: function (v) { return ["add", "all", v.qty || "max"]; }
    },
    characters: {
      title: "Characters",
      command: "character",
      fields: [{ key: "character", type: "grid", catalog: "characters", label: "Character", placeholder: "Search construct, trade name or ID", required: true }],
      build: function (v) { return ["add", v.character.id]; },
      allArgs: function () { return ["add", "all"]; }
    },
    weapons: {
      title: "Weapons",
      command: "equip",
      bulkAmount: "qty",
      fields: [
        { key: "equip", type: "grid", catalog: "weapons", label: "Weapon", placeholder: "Search weapon name or ID", required: true },
        { key: "qty", type: "number", label: "Amount", value: "1", min: 1, max: 99, hint: "copies of that weapon, up to 99" }
      ],
      build: function (v) { return ["add", v.equip.id, v.qty]; },
      allArgs: function (v) { return ["add", "all", v.qty || "1"]; }
    },
    memories: {
      title: "Memories",
      command: "equip",
      bulkAmount: "qty",
      fields: [
        { key: "set", type: "select", label: "Memory set", hint: "all six slots at once", placeholder: "None, pick one memory below",
          options: function () {
            return fetch("/api/panel/memory-sets").then(function (response) {
              if (!response.ok) throw new Error("unavailable");
              return response.json();
            }).then(function (payload) {
              memorySetsCache = payload.sets || [];
              return memorySetsCache.map(function (set) {
                return { value: set.id, label: set.name + " (" + set.meta + ")" };
              });
            });
          } },
        { key: "memory", type: "grid", catalog: "memories", label: "Memory", placeholder: "Search memory name, slot or ID", columns: 3 },
        { key: "qty", type: "number", label: "Amount", value: "1", min: 1, max: 999999999, hint: "server clamps to the item limit" }
      ],
      plan: function (v) {
        var qty = String(v.qty || 1);
        if (v.set) {
          var set = memorySetsCache.filter(function (entry) { return String(entry.id) === String(v.set); })[0];
          if (!set) return [];
          return set.slots.map(function (slot) { return { name: "equip", args: ["add", String(slot.id), qty] }; });
        }
        if (v.memory) return [{ name: "equip", args: ["add", String(v.memory.id), qty] }];
        return [];
      },
      allArgs: function (v) { return ["add", "all", v.qty || "1"]; }
    },
    coatings: {
      title: "Coatings",
      command: "coating",
      fields: [
        { key: "owner", type: "grid", catalog: "characters", label: "Construct", placeholder: "Search construct, trade name or ID", required: true },
        { key: "coating", type: "grid", catalogFrom: function (v) { return loadCoatings(v.owner && v.owner.id); }, dependsOn: "owner", label: "Coating", placeholder: "Search coating name", required: true, hint: "shown for the chosen construct" }
      ],
      build: function (v) { return ["unlock", v.owner.id, v.coating.id]; },
      allArgs: function () { return ["unlock", "all"]; }
    },
    scenes: {
      title: "Scenes",
      command: "scene",
      fields: [{ key: "scene", type: "grid", catalog: "scenes", label: "Scene background", placeholder: "Search scene name or ID", required: true }],
      build: function (v) { return ["unlock", v.scene.id]; },
      allArgs: function () { return ["unlock", "all"]; }
    },
    commandant: {
      title: "Commandant",
      command: "level",
      fields: [{ key: "level", type: "text", label: "Level", placeholder: "1-113 or max", required: true, hint: "digits or max" }],
      build: function (v) { return [v.level]; }
    },
    stages: {
      title: "Stages",
      command: "stage",
      fields: [{ key: "stage", type: "combo", catalog: "stages", label: "Stage", placeholder: "Search stage name or ID", required: true }],
      build: function (v) { return [v.stage.id]; },
      allArgs: function () { return ["all"]; }
    },
    build: {
      title: "Construct",
      command: "equip",
      custom: "build"
    },
    dorm: {
      title: "Dorm",
      command: "dorm",
      fields: [
        { key: "op", type: "select", label: "Operation", placeholder: "Choose an operation", required: true,
          options: function () {
            return Promise.resolve([
              { value: "info", label: "Read the dorm" },
              { value: "fill", label: "Fill furniture" }
            ]);
          },
          hint: "filling grants every piece the tables name that the account does not own" },
        { key: "room", type: "text", label: "Room", placeholder: "all", hint: "a room template id, or all for every room" }
      ],
      build: function (v) {
        if (v.op === "info") return ["info"];
        return ["fill", v.room || "all"];
      },
      allArgs: function () { return ["fill", "all"]; }
    },
    guild: {
      title: "Guild",
      command: "guild",
      fields: [
        { key: "op", type: "select", label: "Operation", placeholder: "Choose an operation", required: true,
          options: function () {
            return Promise.resolve([
              { value: "info", label: "Read the guild" },
              { value: "grant", label: "Grant resources" }
            ]);
          },
          hint: "reads membership, rank and contribution, or moves a store" },
        { key: "kind", type: "select", label: "Store", placeholder: "Choose a store",
          options: function () {
            return Promise.resolve([
              { value: "exp", label: "Guild build" },
              { value: "fund", label: "Guild funds" },
              { value: "contribution", label: "Member contribution" }
            ]);
          },
          hint: "fund and contribution credit the same pool" },
        { key: "amount", type: "number", label: "Amount", value: "1000", min: 1, max: 999999,
          hint: "a pool grant above the daily limit asks for confirm" }
      ],
      build: function (v) {
        if (v.op === "info") return ["info"];
        return ["grant", v.kind, String(v.amount)];
      }
    },
    cleanup: {
      title: "Cleanup",
      command: "cleanup",
      custom: "cleanup"
    }
  };

  var catalogCache = {};
  var current = "items";
  var values = {};
  var picks = {};

  /* One line per section, shown as a tooltip on the rail: the sidebar is where
   * people guess, so each entry states what it actually does. */

  /* One note per rail entry, ascending: a C major scale is exactly seven steps,
   * so every section sounds different instead of wrapping back after four. */
  var RAIL_SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];

  /* The bulk modal lives inside the Construct renderer, whose own state it reads; this hook lets the
   * once-bound footer button reach it without binding a listener per render. */
  var bulkPerformHandler = null;

  function initRailTips() {
    var items = document.querySelectorAll(".rail__item[data-section]");
    Array.prototype.forEach.call(items, function (el, index) {
      var key = el.getAttribute("data-section");

      el.dataset.railIndex = index;
    });
  }

  /* The sound switch states its own state; the label changes with it. */
  function initSound() {
    var button = document.querySelector("#soundBtn");
    if (!button || !window.SelenaAudio) return;

    function paint() {
      var on = window.SelenaAudio.isEnabled();
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.setAttribute("data-tip", on
        ? "Sound cues are on: pluck on section change, chord on success, low note on clear. Click to mute."
        : "Sound cues are off. Click to enable a pluck on section change, a chord on success and a low note on clear.");
      Array.prototype.forEach.call(button.querySelectorAll(".soundBtn__wave"), function (wave) {
        wave.style.opacity = on ? "1" : "0.25";
      });
    }

    button.addEventListener("click", function () {
      window.SelenaAudio.setEnabled(!window.SelenaAudio.isEnabled());
      paint();
    });

    paint();
  }

  var performed = 0;
  var opus = 1;

  /* One-shot petal burst on a successful Perform. Four petals that fade and
   * remove themselves; nothing animates while idle. */
  function celebrate(button) {
    var rect = button.getBoundingClientRect();
    for (var i = 0; i < 4; i += 1) {
      var petal = document.createElement("span");
      petal.className = "petal";
      petal.style.left = (rect.left + rect.width / 2 - 4 + (i - 1.5) * 9) + "px";
      petal.style.top = (rect.top + 10) + "px";
      petal.style.setProperty("--dx", ((i - 1.5) * 24) + "px");
      petal.style.setProperty("--dy", (36 + i * 10) + "px");
      petal.style.animationDelay = (i * 55) + "ms";
      document.body.appendChild(petal);
      (function (node) { setTimeout(function () { node.remove(); }, 1100); })(petal);
    }
  }

  /* Each Silence starts a new opus. */
  function opusLabel(count) {
    return "Opus " + String(opus).padStart(2, "0") + " · " + count + (count === 1 ? " command" : " commands");
  }


  /* ---------------------------------------------------------------- acting account */

  /* The account comes from the server database, not from a sign-in. The panel posts the uid with
   * every command, and the server runs it against the live session when the player is in game or
   * against an offline session built from the same documents when they are not. */
  var acting = { uid: null, username: "" };

  function actingUid() {
    return acting.uid ? Number(acting.uid) : null;
  }

  function command(name, args) {
    var uid = actingUid();
    if (!uid) return Promise.reject(new Error("Pick the acting account first."));

    return fetch("/api/panel/command/" + encodeURIComponent(name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ Uid: uid, Args: (args || []).map(String) })
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          var failure = new Error((payload && payload.msg) || ("HTTP " + response.status));
          failure.data = payload;
          throw failure;
        }
        return { msg: payload.msg, data: payload.data, live: payload.live };
      });
    });
  }

  function selectAccount(accounts) {
    var select = $("#accountSelect");
    var chosen = accounts.filter(function (a) { return String(a.uid) === select.value; })[0];
    acting = chosen ? { uid: chosen.uid, username: chosen.username } : { uid: null, username: "" };
    try { localStorage.setItem("selena.activeAccount", JSON.stringify(acting)); } catch (error) { /* private mode */ }
    updatePreview();
  }

  /* The account picker is the panel's own dropdown. The element behind it still holds the value,
   * because every command reads it, but it is hidden: a native popup would be the only OS control
   * left on the page. */
  var accountMirror = null;

  function buildAccountMirror(accounts) {
    var native = $("#accountSelect");
    var host = $("#accountPicker");
    if (!host || !native) return;

    if (!accountMirror) {
      // The bundled element on a real page, the factory control otherwise. Both answer the same
      // handle, so the code below never learns which one it got.
      accountMirror = window.SelenaUI.picker([], {
        value: native.value,
        search: "Filter accounts",
        onChange: function (value) {
          native.value = value;
          native.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
      host.appendChild(accountMirror.node);
      native.classList.add("is-mirrored");
      native.tabIndex = -1;
      native.setAttribute("aria-hidden", "true");
    }

    accountMirror.setOptions(Array.from(native.options).map(function (option) {
      return { value: option.value, label: option.textContent };
    }), native.value);
  }

  function syncAccountMirror() {
    var native = $("#accountSelect");
    if (!accountMirror || !native) return;
    accountMirror.setValue(native.value);
  }

  /* The list comes from the server's admin endpoints, so it appears as soon as the server runs:
   * nothing here needs a signed-in game session. */
  /* The list and the signature that decides when it needs rebuilding live at module scope: the poll runs
   * outside every section renderer, and `state` there belongs to the build card, not to this file. */
  var accountList = [];
  var accountSignature = null;

  async function loadAccounts() {
    var select = $("#accountSelect");

    try {
      var response = await fetch("/api/panel/accounts", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      var payload = await response.json();
      var accounts = (payload && payload.accounts) || [];

      if (accounts.length === 0) {
        /* The block stays where it is: hiding it on an empty read hid the picker for good, because the
         * poll below never brought it back. */
        accountList = [];
        fillPreviewPlaceholder("no account in the database yet - create one from the Accounts tab");
        return;
      }

      accountList = accounts;
      select.parentElement.hidden = false;

      /* A player who signs in changes the list behind this picker, so it is re-read on a timer and on
       * focus; the rebuild only happens when something actually changed, or the picker would reset the
       * selection under the user every five seconds. */
      var signature = accounts.map(function (account) {
        return account.uid + ":" + (account.playerPresent ? "1" : "0") + ":" + (account.level || 0);
      }).join("|");
      if (signature === accountSignature) return;
      accountSignature = signature;

      var stored = null;
      try { stored = JSON.parse(localStorage.getItem("selena.activeAccount") || "null"); } catch (error) { stored = null; }

      select.textContent = "";
      accounts.forEach(function (account) {
        var option = document.createElement("option");
        option.value = String(account.uid);
        option.textContent = account.username + " \u00b7 UID " + account.uid + (account.playerPresent ? "" : " \u00b7 no player yet");
        select.appendChild(option);
      });

      select.value = stored && accounts.some(function (a) { return String(a.uid) === String(stored.uid); })
        ? String(stored.uid)
        : String(accounts[0].uid);

      buildAccountMirror(accounts);
      selectAccount(accounts);
    } catch (error) {
      fillPreviewPlaceholder("account list unavailable - is the server running?");
    }
  }

  function fillPreviewPlaceholder(text) {
    var preview = $("#previewText");
    if (preview) preview.textContent = text;
  }

  /* ---------------------------------------------------------------- catalogs */


  async function catalog(kind) {
    if (catalogCache[kind]) return catalogCache[kind];
    var response = await fetch("/api/panel/catalog/" + kind, { cache: "no-store" });
    if (!response.ok) throw new Error("catalog unavailable");
    var payload = await response.json();
    var entries = (payload && payload.entries) || [];
    catalogCache[kind] = entries;
    return entries;
  }

  /* ---------------------------------------------------------------- sections */


  /* ---------------------------------------------------------------- cleanup */

  /* Inventory cleanup is the one flow that cannot be a single Perform: it has a
   * read-only preview, and the delete only runs when the user echoes the token
   * the preview returned. Keeping it a custom renderer makes that explicit. */
  function renderCleanup(host) {
    /* Weapons and memories only: items carry no "in use" signal server-side, so a
     * bulk delete could reach a currency, and partners keep their star on the
     * instance rather than a template column. */
    var state = { category: "weapons", star: 3, developed: false, token: null };
    var CATEGORIES = [
      ["weapons", "Weapons"],
      ["memories", "Memories"]
    ];

    var categoryRow = document.createElement("div");
    categoryRow.className = "seg";
    categoryRow.setAttribute("role", "group");
    categoryRow.setAttribute("aria-label", "Category");

    var confirmRow;
    var applyBtn;

    CATEGORIES.forEach(function (pair) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "seg__btn";
      button.textContent = pair[1];
      button.setAttribute("aria-pressed", pair[0] === state.category ? "true" : "false");
      button.addEventListener("click", function () {
        state.category = pair[0];
        state.token = null;
        Array.prototype.forEach.call(categoryRow.children, function (node) {
          node.setAttribute("aria-pressed", node === button ? "true" : "false");
        });
        reset();
      });
      categoryRow.appendChild(button);
    });

    var starRow = document.createElement("div");
    starRow.className = "field__row";
    starRow.innerHTML = '<span class="field__label">Delete up to star<span class="field__hint">nothing above this is touched</span></span>';

    var starInput = document.createElement("input");
    starInput.className = "input input--mono";
    starInput.type = "number";
    starInput.value = String(state.star);
    starRow.appendChild(window.SelenaUI.stepper(starInput, { label: "the star limit", min: 1, max: 6, value: String(state.star) }, function () {
      state.star = Number(starInput.value) || 3;
      state.token = null;
      reset();
    }));

    /* The panel's own switch, not the OS checkbox: one control language across every surface. */
    var devRow = window.SelenaUI.toggle({
      label: "Also delete levelled and promoted entries",
      checked: state.developed,
      tip: "Entries that carry a level or a promotion are kept unless this is on.",
      onChange: function (checked) {
        state.developed = checked;
        state.token = null;
        reset();
      },
    }).node;

    var previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "btn btn--primary";
    previewBtn.id = "cleanupPreview";
    previewBtn.textContent = "Preview";

    var result = document.createElement("div");
    result.className = "cleanup__result";
    result.id = "cleanupResult";
    result.hidden = true;

    confirmRow = document.createElement("div");
    confirmRow.className = "cleanup__confirm";

    var confirmInput = document.createElement("input");
    confirmInput.className = "input";
    confirmInput.type = "text";
    confirmInput.placeholder = "Type CONFIRM CLEANUP";
    confirmInput.setAttribute("aria-label", "Confirmation phrase");

    applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn";
    applyBtn.id = "cleanupApply";
    applyBtn.textContent = "Delete";
    applyBtn.disabled = true;

    confirmRow.appendChild(confirmInput);
    confirmRow.appendChild(applyBtn);

    var actions = document.createElement("div");
    actions.className = "cleanup__actions";
    actions.appendChild(previewBtn);

    host.appendChild(categoryRow);
    host.appendChild(starRow);
    host.appendChild(devRow);
    host.appendChild(actions);
    host.appendChild(result);
    host.appendChild(confirmRow);

    function reset() {
      result.hidden = true;
      result.textContent = "";
      confirmInput.value = "";
      applyBtn.disabled = true;
    }

    confirmInput.addEventListener("input", function () {
      applyBtn.disabled = !state.token || confirmInput.value.trim().toUpperCase() !== "CONFIRM CLEANUP";
    });

    function entryFor(args, ok, detail) {
      performed += 1;
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, { name: "cleanup", args: args }, ok, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      if (ok) window.SelenaAudio.chord(); else window.SelenaAudio.low();
    }

    /* The server answers { msg, data }; the dev mock can still answer JSON in msg,
     * so both shapes are accepted and the structured one wins. */
    function parse(payload) {
      if (payload && payload.data && typeof payload.data === "object") return payload.data;
      var text = payload && payload.msg ? payload.msg : "";
      try {
        return JSON.parse(text);
      } catch (err) {
        return null;
      }
    }

    previewBtn.addEventListener("click", async function () {
      var args = ["preview", state.category, state.star, state.developed ? 1 : 0];
      previewBtn.disabled = true;
      $("#meter").dataset.state = "running";

      try {
        var payload = await command("cleanup", args);
        var data = parse(payload);
        entryFor(args, true, data && data.ok
          ? data.eligible + " eligible / " + data.items + " stacks / " + data.quantity + " units"
          : (payload && payload.msg) || "no preview data");

        if (data && data.ok) {
          state.token = data.token;
          var counts = document.createElement("div");
          counts.className = "cleanup__counts";

          [["Eligible", data.eligible], ["Stacks", data.items], ["Units", data.quantity]].forEach(function (pair) {
            var cell = document.createElement("div");
            var value = document.createElement("strong");
            value.textContent = Number(pair[1]).toLocaleString();
            var label = document.createElement("span");
            label.textContent = pair[0];
            cell.appendChild(value);
            cell.appendChild(label);
            counts.appendChild(cell);
          });

          result.textContent = "";
          result.appendChild(counts);

          if (data.sample && data.sample.length) {
            var list = document.createElement("ul");
            list.className = "cleanup__sample";
            data.sample.forEach(function (line) {
              var item = document.createElement("li");
              item.textContent = line;
              list.appendChild(item);
            });
            result.appendChild(list);
          }

          result.hidden = false;
          confirmRow.hidden = false;
        } else {
          result.textContent = payload && payload.msg ? payload.msg : "Preview returned nothing usable.";
          result.hidden = false;
        }
      } catch (err) {
        entryFor(args, false, err.message);
        result.textContent = err.message;
        result.hidden = false;
      } finally {
        $("#meter").dataset.state = "idle";
        previewBtn.disabled = false;
      }
    });

    applyBtn.addEventListener("click", async function () {
      if (!state.token) return;
      var args = ["apply", state.category, state.star, state.developed ? 1 : 0, "confirm=" + state.token];
      applyBtn.disabled = true;
      $("#meter").dataset.state = "running";

      try {
        var payload = await command("cleanup", args);
        var data = parse(payload);
        entryFor(args, true, data && data.ok
          ? "removed " + data.removed + " stacks (" + (data.items || 0) + " units)"
          : (payload && payload.msg) || "no result");

        result.textContent = "";
        var done = document.createElement("p");
        done.textContent = data && data.ok
          ? "Removed " + Number(data.removed).toLocaleString() + " stacks (" + Number(data.items || 0).toLocaleString() + " units)."
          : (payload && payload.msg) || "The server did not confirm the cleanup.";
        result.appendChild(done);
        result.hidden = false;

        state.token = null;
        confirmInput.value = "";
        celebrate(applyBtn);
      } catch (err) {
        entryFor(args, false, err.message);
        result.textContent = err.message;
        result.hidden = false;
      } finally {
        $("#meter").dataset.state = "idle";
        applyBtn.disabled = !state.token || confirmInput.value.trim().toUpperCase() !== "CONFIRM CLEANUP";
      }
    });
  }

  var fieldNodes = {};
  var memorySetsCache = [];

  async function loadCoatings(owner) {
    if (!owner) return [];
    var response = await fetch("/api/panel/coatings/" + owner);
    if (!response.ok) return [];
    var payload = await response.json();
    return (payload.entries || []).map(function (entry) {
      return { id: entry.id, name: entry.name, meta: entry.meta || "" };
    });
  }

  function fieldControl(field, wrap) {
    var labelRow = document.createElement("span");
    labelRow.className = "field__label";
    var labelText = document.createElement("span");
    labelText.textContent = field.label;
    labelRow.appendChild(labelText);
    if (field.hint) {
      var hint = document.createElement("span");
      hint.className = "field__hint";
      hint.textContent = field.hint;
      labelRow.appendChild(hint);
    }
    wrap.appendChild(labelRow);

    if (field.type === "combo") {
      var picker = window.SelenaUI.combo(field, function () { return catalog(field.catalog); }, bump);
      picks[field.key] = picker;
      wrap.appendChild(picker.node);
      return;
    }

    if (field.type === "grid") {
      var loader = field.catalogFrom
        ? function () { return field.catalogFrom(values); }
        : function () { return catalog(field.catalog); };
      var gallery = window.SelenaUI.grid(field, loader, bump);
      picks[field.key] = gallery;
      wrap.appendChild(gallery.node);
      return;
    }

    if (field.type === "select") {
      // The bundled element when the page has it, the factory control otherwise: the panel's own
      // dropdown either way, because a native popup is the one OS control that does not follow
      // the console.
      var fieldPicker = window.SelenaUI.picker([{ value: "", label: field.placeholder || "None" }], {
        value: "",
        search: field.label || "Filter",
        onChange: function (value) {
          values[field.key] = value;
          bump();
        },
      });
      values[field.key] = "";

      (field.options || function () { return Promise.resolve([]); })()
        .then(function (list) {
          fieldPicker.setOptions([{ value: "", label: field.placeholder || "None" }].concat((list || []).map(function (item) {
            return { value: String(item.value), label: item.label };
          })), "");
        })
        .catch(function () { /* placeholder stays; Perform has nothing to send */ });

      wrap.appendChild(fieldPicker.node);
      return;
    }

    var input = document.createElement("input");
    input.className = "input" + (field.type === "number" ? " input--mono" : "");
    input.type = field.type === "number" ? "number" : "text";
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    if (field.value !== undefined) input.value = field.value;
    if (field.placeholder) input.placeholder = field.placeholder;
    values[field.key] = field.value !== undefined ? field.value : "";
    input.addEventListener("input", function () {
      values[field.key] = input.value.trim();
      bump();
    });
    wrap.appendChild(field.type === "number"
      ? window.SelenaUI.stepper(input, field, bump)
      : input);
  }

  function bump() {
    var section = SECTIONS[current];
    if (!section) return;

    section.fields.forEach(function (field) {
      if (field.type !== "combo" && field.type !== "grid") return;
      var pick = picks[field.key] && picks[field.key].value();
      values[field.key] = pick || null;
    });

    section.fields.forEach(function (field) {
      if (!field.dependsOn) return;
      var node = fieldNodes[field.key];
      if (!node) return;
      var dependency = values[field.dependsOn];
      if (!dependency) return;
      var marker = dependency.id || dependency;
      if (node.dependsOn === marker) return;
      node.dependsOn = marker;
      delete picks[field.key];
      node.wrap.textContent = "";
      fieldControl(field, node.wrap);
    });

    updatePreview();
  }

  function renderSection(key) {
    current = key;
    values = {};
    picks = {};
    fieldNodes = {};

    var section = SECTIONS[key];

    document.querySelectorAll(".rail__item[data-section]").forEach(function (el) {
      if (el.dataset.section === key) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    $("#sectionTitle").textContent = section.title;
    // No section-specific buttons exist here; clear any leftover from an older render.
    var actionRow = document.getElementById("sectionActions");
    if (actionRow) [...actionRow.querySelectorAll("[data-section-action]")].forEach(function (b) { b.remove(); });

    var host = $("#formFields");
    host.textContent = "";

    var isCustom = Boolean(section.custom);
    $("#preview").hidden = isCustom;
    $("#runBtn").hidden = isCustom;
    var previewLabel = document.querySelector("#previewLabel");
    if (previewLabel) previewLabel.hidden = isCustom;

    /* Tutti exists only where a section can speak for every entry at once. The press opens a short
     * modal that says what it does and carries the bulk amount; nothing fires from the button alone. */
    var allBtn = $("#allBtn");
    var hasAll = typeof section.allArgs === "function" && !isCustom;
    allBtn.hidden = !hasAll;
    allBtn.disabled = false;
    if (hasAll) {
      allBtn.setAttribute("data-tip", "Tutti: apply this tab to every entry at once. Opens a short form with its own amount.");
      allBtn.setAttribute("aria-label", "Tutti: run this command for every entry");
    }

    if (section.custom === "build") {
      renderBuild(host);
      return;
    }

    if (section.custom === "cleanup") {
      renderCleanup(host);
      return;
    }

    section.fields.forEach(function (field) {
      var wrap = document.createElement("label");
      wrap.className = "field";
      fieldNodes[field.key] = { wrap: wrap };
      fieldControl(field, wrap);
      host.appendChild(wrap);
    });

    if (section.note) {
      var note = document.createElement("p");
      note.className = "hint-block";
      note.textContent = section.note;
      host.appendChild(note);
    }

    var meta = $("#catalogMeta");
    var comboField = section.fields.filter(function (f) { return f.type === "combo" || f.type === "grid"; })[0];
    if (comboField) {
      meta.textContent = "catalog: loading…";
      var first = comboField.catalogFrom ? comboField.catalogFrom(values) : catalog(comboField.catalog);
      first.then(function (data) {
        meta.textContent = "catalog: " + data.length + " entries";
      }).catch(function () {
        meta.textContent = "catalog: unavailable";
      });
    } else {
      meta.textContent = "catalog: n/a";
    }

    updatePreview();
  }

  function buildPlan() {
    var section = SECTIONS[current];
    if (!section) return [];

    section.fields.forEach(function (field) {
      if (field.type !== "combo" && field.type !== "grid") return;
      var pick = picks[field.key] && picks[field.key].value();
      values[field.key] = pick || null;
    });

    if (typeof section.plan === "function") return section.plan(values) || [];

    for (var i = 0; i < section.fields.length; i += 1) {
      var field = section.fields[i];
      if (!field.required) continue;
      if (field.type === "combo" || field.type === "grid") {
        if (!values[field.key]) return [];
      } else if (values[field.key] === undefined || values[field.key] === "") {
        return [];
      }
    }

    var args = section.build(values);
    if (args.some(function (a) { return a === null || a === undefined || a === ""; })) return [];
    return [{ name: section.command, args: args.map(String) }];
  }

  function updatePreview() {
    var plan = buildPlan();
    var preview = $("#preview");
    var text = $("#previewText");
    var run = $("#runBtn");

    if (plan.length === 0) {
      text.textContent = "choose a target";
      preview.dataset.ready = "false";
      run.disabled = true;
      $("#runHint").textContent = "";
      return;
    }

    var first = plan[0];
    var label = "/" + first.name + " " + first.args.join(" ");
    if (plan.length > 1) label += " (+" + (plan.length - 1) + " more)";

    text.textContent = label;
    preview.dataset.ready = "true";
    run.disabled = false;
    $("#runHint").textContent = actingUid() ? "" : "pick an acting account";
  }

  async function perform(event) {
    if (event) event.preventDefault();

    var plan = buildPlan();
    if (plan.length === 0) return;

    if (!actingUid()) {
      $("#runHint").textContent = "pick an acting account";
      return;
    }

    var run = $("#runBtn");
    run.disabled = true;
    run.textContent = "Performing…";
    $("#meter").dataset.state = "running";

    var lines = [];
    var failures = 0;
    /* The server answers whether the change reached a live session; when it did not, the client
     * only shows it after its next login, and saying so beats a silent "OK". */
    var offlineOnly = false;

    try {
      for (var i = 0; i < plan.length; i += 1) {
        var step = plan[i];
        try {
          var response = await command(step.name, step.args);
          if (response && response.live === false) offlineOnly = true;
          /* One command reads as its result; a set of six (a memory set) needs its own line each,
           * otherwise the log shows the same command twice. */
          var result = (response && response.msg) || "OK";
          lines.push(plan.length > 1 ? step.name + " " + step.args.join(" ") + " -> " + result : result);
        } catch (stepError) {
          failures += 1;
          lines.push("/" + step.name + " " + step.args.join(" ") + " -> " + ((stepError && stepError.message) || "failed"));
        }
      }

      if (offlineOnly) lines.push("stored in the database - the game client shows it at its next login");

      performed += 1;
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, { name: plan[0].name, args: plan[0].args }, failures === 0, lines.join("\n"));
      $("#consoleMeta").textContent = opusLabel(performed);
      if (failures === 0) { celebrate(run); window.SelenaAudio.chord(); } else { window.SelenaAudio.low(); }
    } finally {
      $("#meter").dataset.state = "idle";
      run.textContent = "Perform";
      run.disabled = false;
      updatePreview();
    }
  }

  /* ---------------------------------------------------------------- tune */

  const RANK_LABELS = { 1: "B", 2: "A", 3: "S", 4: "SS", 5: "SSS", 6: "SSS+" };
  const MEMORY_LEVEL_CAP = 45;
  const WEAPON_LEVEL_CAP = 45;

  function rankText(quality, star, hasStar) {
    const label = RANK_LABELS[quality] || `Q${quality}`;
    return quality >= 6 ? label : label + (hasStar ? star : 0);
  }

  /* The tune flow designs a build from the tables, then writes it in one pass. Nothing in the
   * catalogue depends on what this account owns, so a construct, memory or weapon the account
   * never held can still be tuned in. */
  function renderBuild(host) {
    const state = { catalog: null, detail: null, characterId: null, identity: null, current: null, template: null, suitOfMemory: {} };

    const card = document.createElement("div");
    card.className = "build";

    const pickerLabel = document.createElement("span");
    pickerLabel.className = "field__label";
    pickerLabel.textContent = "Construct";
    host.appendChild(pickerLabel);

    const picker = window.SelenaUI.combo(
      { key: "construct", catalog: "characters", placeholder: "Search construct, trade name or ID" },
      function () { return catalog("characters"); },
      function () {
        const pick = picker.value();
        if (pick) select(pick.id);
      }
    );
    host.appendChild(picker.node);
    host.appendChild(card);

    function log(name, args, ok, detail) {
      performed += 1;
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, { name, args }, ok, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      if (ok) window.SelenaAudio.chord(); else window.SelenaAudio.low();
    }

    function ensureCatalog() {
      if (state.catalog) return Promise.resolve(state.catalog);
      return fetch("/api/panel/tune-catalog")
        .then((response) => {
          if (!response.ok) throw new Error("the character tables are not readable");
          return response.json();
        })
        .then((payload) => { state.catalog = payload; return payload; });
    }

    function rows(entries) {
      const box = document.createElement("div");
      box.className = "build__rows";
      entries.forEach((entry) => {
        const line = document.createElement("div");
        line.className = "field__row";
        const key = document.createElement("span");
        key.textContent = entry[0];
        const value = document.createElement("b");
        value.textContent = entry[1];
        line.append(key, value);
        box.appendChild(line);
      });
      return box;
    }

    function button(label, tip, handler, primary) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = primary ? "btn" : "btn btn--quiet";
      node.textContent = label;
      node.setAttribute("data-tip", tip);
      node.addEventListener("click", handler);
      return node;
    }

    async function select(characterId) {
      state.characterId = characterId;
      card.textContent = "";
      card.appendChild(rows([["Construct", "reading…"]]));

      let catalogPayload = null;
      try {
        catalogPayload = await ensureCatalog();
      } catch (error) {
        card.textContent = "";
        card.appendChild(rows([["Construct", error.message]]));
        return;
      }

      state.identity = catalogPayload.characters.find((character) => character.id === characterId) || null;
      state.detail = await fetch(`/api/panel/tune-character/${characterId}`)
        .then((response) => (response.ok ? response.json() : null));
      state.current = null;
      try {
        const info = await command("character", ["info", String(characterId)]);
        state.current = (info && info.data) || null;
      } catch (error) {
        state.current = null;
      }

      state.template = buildTemplate();
      paintCard();
    }

    function baseRankLabel() {
      const quality = state.identity ? state.identity.baseQuality : 1;
      const stars = state.detail && state.detail.stars ? state.detail.stars[quality] || 0 : 0;
      return rankText(quality, 0, stars > 0);
    }

    function paintCard() {
      card.textContent = "";
      const identity = state.identity;
      const current = state.current;
      if (!identity) return;

      const name = identity.name + (identity.tradeName ? " · " + identity.tradeName : "");
      card.appendChild(rows([
        ["Construct", name],
        ["Base rank", baseRankLabel()],
        ["Level", current ? String(current.character.level) : "not in this account"],
        ["Rank", current
          ? rankText(current.character.quality, current.character.star, true)
          : "-"],
        ["Promotion", current && state.detail
          ? (state.detail.promotions.find((promotion) => promotion.grade === current.character.grade) || {}).name || String(current.character.grade)
          : "-"],
        ["Memories", current ? String((current.memories || []).length) : "-"],
      ]));

      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(
        button("Tune", "Open the design surface: level, rank, promotion, the six memories with their resonances, hypertune, weapon and harmony.", openTune, true),
        button("Tutti", "Bulk level: sets level, rank, promotion and skills for every construct in this account. Memories and weapons are left alone.", openBulk)
      );
      card.appendChild(actions);
    }

    function buildTemplate() {
      const detail = state.detail || { promotions: [], stars: {}, maxLevel: 80 };
      const baseQuality = state.identity ? state.identity.baseQuality : 1;
      const promos = detail.promotions.length > 0 ? detail.promotions : [{ grade: 1, name: "Private I" }];
      const current = state.current;
      // A tune edits the build the character already has instead of resetting it: every control starts
      // on the current state, and the writer replaces only what the request states. Performing an
      // untouched form is a no-op, not a wipe.
      const worn = current ? (current.memories || []).filter((memory) => memory.equippedTo === current.character.id) : [];
      const design = {
        level: current ? current.character.level : 1,
        quality: current ? current.character.quality : baseQuality,
        star: current ? current.character.star : 0,
        grade: current ? current.character.grade : promos[0].grade,
        // 0 means "keep the level each memory already carries"; only Max states a level.
        memoryLevel: 0,
        hypertune: worn.some((memory) => (memory.awakeSlots || []).length > 0),
        hypertuneTouched: false,
        skillLevel: (current && current.character.skillLevel) || detail.skillMax || 0,
        skillLevelTouched: false,
        slots: {},
        weapon: { templateId: 0, level: WEAPON_LEVEL_CAP, harmonySuit: 0 },
        resonances: {},
        weaponResonances: [0, 0, 0],
      };
      for (let slot = 1; slot <= 6; slot += 1) {
        const memory = worn.find((entry) => entry.site === slot) || null;
        design.slots[slot] = memory ? memory.templateId : 0;
        const top = memory ? (memory.resonance || []).find((entry) => entry.slot === 1) : null;
        const bottom = memory ? (memory.resonance || []).find((entry) => entry.slot === 2) : null;
        design.resonances[slot] = { top: top ? top.templateId : 0, bottom: bottom ? bottom.templateId : 0 };
        for (const entry of (memory && memory.resonance) || []) {
          if (entry && entry.templateId) {
            RESONANCE_KINDS.set(entry.templateId, String(entry.type).toLowerCase() === "attrib" ? "attrib" : "skill");
          }
        }
      }
      const weapon = current ? (current.weapons || []).find((entry) => entry.equippedTo === current.character.id) : null;
      design.weapon.templateId = weapon ? weapon.templateId : 0;
      design.weapon.level = weapon ? weapon.level : WEAPON_LEVEL_CAP;
      design.weapon.harmonySuit = weapon ? (weapon.overrunChoseSuit || 0) : 0;
      for (const entry of (weapon && weapon.resonance) || []) {
        if (entry.slot >= 1 && entry.slot <= 3) design.weaponResonances[entry.slot - 1] = entry.templateId;
      }
      return {
        levels: { min: 1, max: Math.max(1, detail.maxLevel || 80) },
        skills: { min: 1, max: Math.max(0, detail.skillMax || 0), count: detail.skillCount || 0 },
        promotions: promos,
        stars: detail.stars || {},
        baseQuality,
        design,
      };
    }

    function rankSteps() {
      const steps = [];
      const stars = state.template.stars;
      for (let quality = state.template.baseQuality; quality <= 6; quality += 1) {
        const count = quality >= 6 ? 1 : Math.max(1, stars[quality] || 0);
        for (let star = 0; star < count; star += 1) {
          steps.push({ quality, star, label: rankText(quality, star, count > 1) });
        }
      }
      return steps;
    }

    function memoryOptions(site) {
      return (state.catalog.memories || [])
        .filter((memory) => memory.site === site)
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    }

    function fillSelect(select, options, value) {
      select.textContent = "";
      options.forEach((option) => {
        const node = document.createElement("option");
        node.value = String(option.value);
        node.textContent = option.label;
        select.appendChild(node);
      });
      select.value = String(value || (options[0] ? options[0].value : ""));
    }

    function slider(labelText, min, max, value, format, onChange, tip) {
      const row = document.createElement("div");
      row.className = "tune__slider";
      const label = document.createElement("span");
      label.className = "tune__label";
      label.textContent = labelText;
      const control = window.SelenaUI.slider({
        min: min,
        max: max,
        value: value,
        format: format,
        onChange: onChange,
        tip: tip || "",
      });
      row.append(label, control.node);
      return row;
    }

    /* ---------------------------------------------------------- bulk level */

    function bulkRanks() {
      /* Base rank is the first stop so a level pass can leave rank alone, and the next stop is S0: most
       * constructs are S rank, so the B and A sub-steps are not worth a stop each. */
      const stops = [{ quality: 0, star: 0, label: "as is" }];
      const stars = (state.template && state.template.stars) || {};
      for (let quality = 3; quality <= 6; quality += 1) {
        const count = quality >= 6 ? 1 : Math.max(1, stars[quality] || 0);
        for (let star = 0; star < count; star += 1) {
          stops.push({ quality, star, label: rankText(quality, star, count > 1) });
        }
      }
      return stops;
    }

    function openBulk() {
      const body = $("#bulkBody");
      body.textContent = "";
      const ranks = bulkRanks();
      const promotions = (state.template && state.template.promotions) || [];
      const levels = (state.template && state.template.levels && state.template.levels.max) || 80;
      const skillMax = (state.template && state.template.skills && state.template.skills.max) || 0;
      const choice = { level: 0, rank: 0, grade: 0, skill: 0, ranks: ranks, promotions: promotions };
      state.bulkChoice = choice;

      const lead = document.createElement("p");
      lead.className = "tutti__lead";
      lead.textContent = "Bulk level writes level, rank, promotion and skills for every construct in this account. "
        + "Memories, weapons, resonance and harmony stay as they are. Every slider starts at as is, so only what you move is written.";
      body.appendChild(lead);

      function paintNote() {
        const bits = ["Level " + (choice.level > 0 ? String(choice.level) : "as is")];
        bits.push("Rank " + ranks[choice.rank].label);
        if (promotions.length > 0) bits.push("Promotion " + (choice.grade > 0 ? promotions[choice.grade - 1].name : "as is"));
        if (skillMax > 0) bits.push("Skills " + (choice.skill > 0 ? "Lv " + choice.skill : "as is"));
        $("#bulkNote").textContent = bits.join(" \u00b7 ");
      }

      body.appendChild(slider("Level", 0, levels, 0, function (value) { return value > 0 ? "Lv " + value : "as is"; },
        function (value) { choice.level = value; paintNote(); },
        "Level for every construct. as is leaves each one at the level it already has."));
      body.appendChild(slider("Rank", 0, ranks.length - 1, 0, function (value) { return ranks[value].label; },
        function (value) { choice.rank = value; paintNote(); },
        "Rank for every construct. as is leaves each rank alone; the next stop is S0, then the S and SS stars."));
      if (promotions.length > 0) {
        body.appendChild(slider("Promotion", 0, promotions.length, 0, function (value) { return value === 0 ? "as is" : promotions[value - 1].name; },
          function (value) { choice.grade = value; paintNote(); },
          "Promotion for every construct. as is leaves each one where it stands."));
      }
      if (skillMax > 0) {
        body.appendChild(slider("Skills", 0, skillMax, 0, function (value) { return value === 0 ? "as is" : "Lv " + value; },
          function (value) { choice.skill = value; paintNote(); },
          "Every skill of every construct. as is leaves the levels the construct already has."));
      }

      paintNote();
      $("#bulkModal").hidden = false;
      $("#bulkPerform").focus();
    }

    async function runBulkLevel() {
      const choice = state.bulkChoice;
      if (!choice) return;
      const uid = actingUid();
      if (!uid) { $("#runHint").textContent = "pick an acting account"; return; }

      const payload = { Uid: Number(uid) };
      if (choice.level > 0) payload.Level = choice.level;
      if (choice.rank > 0) {
        const step = choice.ranks[choice.rank];
        payload.Quality = step.quality;
        payload.Star = step.star;
      }
      if (choice.grade > 0) payload.Grade = choice.promotions[choice.grade - 1].grade;
      if (choice.skill > 0) payload.SkillLevel = choice.skill;

      const args = Object.keys(payload).filter(function (key) { return key !== "Uid"; })
        .map(function (key) { return key + " " + payload[key]; });
      const cmd = { name: "level all", args: args };

      try {
        const response = await fetch("/api/panel/tune-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (res) { return res.json(); });
        if (!response || response.ok === false) throw new Error((response && response.msg) || "the bulk level was refused");
        const report = response.data || {};
        const failed = report.failed || report.Failed || [];
        performed += 1;
        let detail = "applied " + (report.applied !== undefined ? report.applied : report.Applied) + " of " + (report.total !== undefined ? report.total : report.Total);
        if (failed.length > 0) {
          detail += String.fromCharCode(10) + failed.map(function (entry) { return entry.characterId + ": " + entry.error; }).join(String.fromCharCode(10));
        }
        window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, failed.length === 0, detail);
        $("#consoleMeta").textContent = opusLabel(performed);
        window.SelenaAudio.chord();
      } catch (err) {
        performed += 1;
        window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, (err && err.message) || String(err));
        $("#consoleMeta").textContent = opusLabel(performed);
        window.SelenaAudio.low();
      }
    }

    bulkPerformHandler = runBulkLevel;

    function openTune() {
      const modal = $("#tuneModal");
      const body = $("#tuneBody");
      $("#tuneTitle").textContent = "Tune " + state.identity.name;
      body.textContent = "";

      const design = state.template.design;
      state.modalDesign = design;

      const section = function (title, note) {
        const node = document.createElement("section");
        node.className = "tune";
        const head = document.createElement("div");
        head.className = "tune__head";
        const label = document.createElement("span");
        label.className = "tune__label";
        label.textContent = title;
        head.appendChild(label);
        if (note) {
          const value = document.createElement("span");
          value.className = "tune__value";
          value.textContent = note;
          head.appendChild(value);
        }
        node.appendChild(head);
        return node;
      };

      // progression: level, rank and promotion, each a slider over the table's own ladder
      const progression = section("Progression");
      const steps = rankSteps();
      let rankIndex = steps.findIndex((step) => step.quality === design.quality && step.star === design.star);
      if (rankIndex < 0) rankIndex = 0;
      let promotionIndex = Math.max(0, state.template.promotions.findIndex((promotion) => promotion.grade === design.grade));
      const progressionValue = document.createElement("span");
      progressionValue.className = "tune__value";
      progression.querySelector(".tune__head").appendChild(progressionValue);
      const paintProgression = function () {
        progressionValue.textContent = steps[rankIndex].label
          + " · " + state.template.promotions[promotionIndex].name
          + " · Lv " + design.level
          + (state.template.skills.max > 1 ? " · Skills Lv " + (design.skillLevel || state.template.skills.min) : "");
      };
      progression.appendChild(slider("Level", 1, state.template.levels.max, design.level, (value) => "Lv " + value, (value) => {
        design.level = value;
        paintProgression();
      }));
      progression.appendChild(slider("Rank", 0, steps.length - 1, rankIndex, (value) => steps[value].label, (value) => {
        rankIndex = value;
        design.quality = steps[value].quality;
        design.star = steps[value].star;
        paintProgression();
      }));
      progression.appendChild(slider("Promotion", 0, state.template.promotions.length - 1, promotionIndex, (value) => state.template.promotions[value].name, (value) => {
        promotionIndex = value;
        design.grade = state.template.promotions[value].grade;
        paintProgression();
      }));
      // Skill levels: the game raises every skill of a construct from its own page, and the ceiling
      // is the highest level the client can build, which the catalog reads from the skill effect rows.
      if (state.template.skills.max > 1) {
        progression.appendChild(slider("Skills", state.template.skills.min, state.template.skills.max, design.skillLevel || state.template.skills.min, (value) => "Lv " + value, (value) => {
          design.skillLevel = value;
          design.skillLevelTouched = true;
          paintProgression();
        }));
      }
      paintProgression();
      body.appendChild(progression);

      // one memory per grid slot, each list filtered to that slot
      const memories = section("Memory slots", "one memory per slot");
      const memoryGrid = document.createElement("div");
      memoryGrid.className = "tune__grid";
      for (let slot = 1; slot <= 6; slot += 1) {
        const cell = document.createElement("div");
        cell.className = "tune__cell";
        const slotLabel = document.createElement("span");
        slotLabel.className = "tune__slot";
        slotLabel.textContent = "Slot " + slot;
        const list = [{ value: 0, label: "empty" }].concat(memoryOptions(slot).map((memory) => ({
          value: memory.id,
          label: memory.name + " · " + memory.star + "★",
        })));
        const picker = window.SelenaUI.picker(list, {
          value: design.slots[slot],
          search: "Filter memories",
          onChange: function (value) {
            design.slots[slot] = Number(value);
            design.resonances[slot] = { top: 0, bottom: 0 };
            if (!design.weapon.harmonySuit) design.weapon.harmonySuit = state.suitOfMemory[Number(value)] || 0;
            cell.classList.toggle("is-empty", Number(value) === 0);
            paintResonances();
          },
        });
        cell.classList.toggle("is-empty", !design.slots[slot]);
        cell.append(slotLabel, picker.node);
        memoryGrid.appendChild(cell);
      }
      memories.appendChild(memoryGrid);
      body.appendChild(memories);

      // One level for all six memories: the writer takes a single MemoryLevel for the set, so this is
      // not a per memory control, and 0 keeps each memory at the level it already carries.
      const memoryLevel = section("Memory level", "one level for all six memories");
      memoryLevel.appendChild(slider("Level", 0, MEMORY_LEVEL_CAP, design.memoryLevel || 0,
        (value) => (value > 0 ? "Lv " + value : "unchanged"),
        (value) => { design.memoryLevel = value; },
        "Level every memory in the set at once. 0 leaves each memory at the level it already carries."));
      body.appendChild(memoryLevel);

      // two resonances per memory: the stat pool on slot 1, the construct's skill on slot 2
      const resonanceSection = section("Memory resonance", "upper: basic and orb levels, lower: kit skills");
      // The client's awaken condition counts a hypertuned resonance skill and a stat pick never counts, so a tune
      // that fills every upper slot with a stat writes a build that cannot awaken.
      const resonanceNote = document.createElement("p");
      resonanceNote.className = "tune__note";
      resonanceNote.textContent = "A stat pick never counts toward an awaken. To awaken from a tune, set the upper "
        + "resonance to a skill, or leave the upper slot empty and add it in game afterwards; the lower slot can stay "
        + "as the tune wrote it.";
      resonanceSection.appendChild(resonanceNote);
      const resonanceGrid = document.createElement("div");
      resonanceGrid.className = "tune__grid";
      resonanceSection.appendChild(resonanceGrid);
      body.appendChild(resonanceSection);

      let paintResonances = function () {
        resonanceGrid.textContent = "";
        for (let slot = 1; slot <= 6; slot += 1) {
          const cell = document.createElement("div");
          cell.className = "tune__cell";
          const slotLabel = document.createElement("span");
          slotLabel.className = "tune__slot";
          slotLabel.textContent = "Slot " + slot;
          cell.appendChild(slotLabel);

          const templateId = design.slots[slot];
          if (!templateId) {
            const empty = document.createElement("span");
            empty.className = "tune__pick";
            empty.textContent = "no memory";
            cell.appendChild(empty);
            resonanceGrid.appendChild(cell);
            continue;
          }

          const top = window.SelenaUI.picker([{ value: 0, label: "upper: none" }], {
            value: design.resonances[slot].top,
            search: "Filter upper resonance",
            onChange: function (value) { design.resonances[slot].top = Number(value); },
          });
          const bottom = window.SelenaUI.picker([{ value: 0, label: "lower: none" }], {
            value: design.resonances[slot].bottom,
            search: "Filter lower resonance",
            onChange: function (value) { design.resonances[slot].bottom = Number(value); },
          });

          const load = function (slotNumber, control, key, noneLabel) {
            // include= lets the endpoint echo a stored resonance this slot no longer offers, so an old
            // build reads as "Signature Move Level · stored on this slot" instead of an empty control.
            const query = "/api/panel/resonance/" + templateId + "/" + slotNumber
              + "?character=" + state.characterId + "&include=" + (design.resonances[slot][key] || 0);
            fetch(query)
              .then((response) => (response.ok ? response.json() : { entries: [] }))
              .then((payload) => {
                const entries = (payload && payload.entries) || [];
                for (const entry of entries) RESONANCE_KINDS.set(entry.id, entry.kind);
                control.setOptions([{ value: 0, label: noneLabel }].concat(entries.map((entry) => ({
                  value: entry.id,
                  label: entry.name + (entry.meta ? " · " + entry.meta : ""),
                }))), design.resonances[slot][key]);
              })
              .catch(() => {});
          };
          load(1, top, "top", "upper: none");
          load(2, bottom, "bottom", "lower: none");

          cell.append(top.node, bottom.node);
          resonanceGrid.appendChild(cell);
        }
      };
      paintResonances();

      const hypertune = window.SelenaUI.toggle({
        label: "Hypertune all six memories",
        checked: design.hypertune,
        tip: "Hypertune every memory: both resonance slots of all six count as awakened.",
        onChange: function (checked) { design.hypertune = checked; design.hypertuneTouched = true; },
      });
      body.appendChild(hypertune.node);

      // weapon, its three resonances and its harmony
      const weaponSection = section("Weapon");
      const equipType = (state.detail && state.detail.equipType) || 0;
      const carried = (state.catalog.weapons || []).filter((weapon) => !equipType || weapon.type === equipType);
      const weaponPicker = window.SelenaUI.picker([{ value: 0, label: "empty" }].concat(carried
        .sort((left, right) => left.star - right.star || String(left.name).localeCompare(String(right.name)))
        .map((weapon) => ({ value: weapon.id, label: weapon.name + " · " + weapon.star + "★" }))), {
        value: design.weapon.templateId,
        search: "Filter weapons",
        onChange: function (value) {
          design.weapon.templateId = Number(value);
          design.weaponResonances = [];
          const star = weaponStar(design.weapon.templateId);
          if (star < 6) design.weapon.harmonySuit = 0;
          paintWeaponResonances();
          paintHarmonyGate();
        },
      });
      weaponSection.appendChild(weaponPicker.node);
      weaponSection.appendChild(slider("Weapon level", 1, WEAPON_LEVEL_CAP, design.weapon.level, (value) => "Lv " + value, (value) => {
        design.weapon.level = value;
      }));

      const weaponGrid = document.createElement("div");
      weaponGrid.className = "tune__grid";
      weaponSection.appendChild(weaponGrid);
      body.appendChild(weaponSection);

      function weaponStar(templateId) {
        const weapon = (state.catalog.weapons || []).find((entry) => entry.id === Number(templateId));
        return weapon ? Number(weapon.star || 0) : 0;
      }

      function paintWeaponResonances() {
        weaponGrid.textContent = "";
        const templateId = design.weapon.templateId;
        const star = weaponStar(templateId);
        const custom = star >= 6;
        for (let slot = 1; slot <= 3; slot += 1) {
          const cell = document.createElement("div");
          cell.className = "tune__cell";
          const slotLabel = document.createElement("span");
          slotLabel.className = "tune__slot";
          slotLabel.textContent = "Resonance " + slot;
          cell.appendChild(slotLabel);
          if (!templateId) {
            const empty = document.createElement("span");
            empty.className = "tune__pick";
            empty.textContent = "no weapon";
            cell.appendChild(empty);
            weaponGrid.appendChild(cell);
            continue;
          }
          if (!custom) {
            const flat = document.createElement("span");
            flat.className = "tune__pick";
            flat.textContent = star === 5 ? "flat attack only" : "default weapon";
            cell.appendChild(flat);
            weaponGrid.appendChild(cell);
            continue;
          }
          const picker = window.SelenaUI.picker([{ value: 0, label: "none" }], {
            value: design.weaponResonances[slot - 1] || 0,
            search: "Filter skills",
            tip: "Weapon resonance " + slot + ": the class skill pool the tables give this weapon.",
            onChange: function (value) { design.weaponResonances[slot - 1] = Number(value); },
          });
          fetch("/api/panel/resonance/" + templateId + "/" + slot + "?character=" + state.characterId)
            .then((response) => (response.ok ? response.json() : { entries: [] }))
            .then((payload) => {
              const entries = (payload && payload.entries) || [];
              picker.setOptions([{ value: 0, label: "none" }].concat(entries.map((entry) => ({
                value: entry.id,
                label: entry.name + (entry.meta ? " · " + entry.meta : ""),
              }))), design.weaponResonances[slot - 1] || 0);
            })
            .catch(() => {});
          cell.appendChild(picker.node);
          weaponGrid.appendChild(cell);
        }
      }
      paintWeaponResonances();

      // Harmony names a set, never a memory: an active harmony counts as two pieces of that set,
      // so four signature memories plus harmony already complete a four piece bonus.
      const harmony = section("Harmony", "one set, counted as two pieces");
      const harmonyPicker = window.SelenaUI.picker([{ value: 0, label: "none" }], {
        value: design.weapon.harmonySuit,
        search: "Filter sets",
        onChange: function (value) { design.weapon.harmonySuit = Number(value); },
      });
      harmony.appendChild(harmonyPicker.node);

      // A five star and a four star take no harmony, so the picker says that instead of offering
      // a choice the server would refuse.
      function paintHarmonyGate() {
        const star = design.weapon.templateId ? weaponStar(design.weapon.templateId) : 0;
        harmonyPicker.setDisabled(star > 0 && star < 6);
      }
      paintHarmonyGate();

      fetch("/api/panel/memory-sets")
        .then((response) => (response.ok ? response.json() : { sets: [] }))
        .then((payload) => {
          const sets = (payload && payload.sets) || [];
          state.suitOfMemory = {};
          sets.forEach((set) => {
            (set.slots || []).forEach((slot) => { state.suitOfMemory[slot.id] = set.id; });
          });
          harmonyPicker.setOptions([{ value: 0, label: "none" }].concat(sets.map((set) => ({
            value: set.id,
            label: set.name + (set.star ? " · " + set.star + "★" : ""),
          }))), design.weapon.harmonySuit);
        })
        .catch(() => {});
      body.appendChild(harmony);

      $("#tuneNote").textContent = "Nothing is spent from the account. Perform writes the build.";
      modal.hidden = false;
      window.SelenaUI.initTooltips();
    }

    function payload(design) {
      // The type travels with the pick, never with the slot: the upper list carries skills as well as
      // stats, and a skill sent as "attrib" is refused against the stat pool.
      const typeOf = function (templateId) { return RESONANCE_KINDS.get(templateId) === "attrib" ? "attrib" : "skill"; };
      const memories = [];
      for (let slot = 1; slot <= 6; slot += 1) {
        const templateId = design.slots[slot];
        if (!templateId) continue;
        const entry = { Slot: slot, TemplateId: templateId };
        if (design.resonances[slot].top) entry.Top = { Slot: 1, Type: typeOf(design.resonances[slot].top), TemplateId: design.resonances[slot].top };
        if (design.resonances[slot].bottom) entry.Bottom = { Slot: 2, Type: typeOf(design.resonances[slot].bottom), TemplateId: design.resonances[slot].bottom };
        memories.push(entry);
      }
      const body = {
        Uid: Number($("#accountSelect").value),
        CharacterId: state.characterId,
        Character: { Level: design.level, Quality: design.quality, Star: design.star, Grade: design.grade },
        SkillLevel: design.skillLevelTouched ? (design.skillLevel || 0) : 0,
        MemoryLevel: design.memoryLevel || 0,
        Hypertune: design.hypertuneTouched ? Boolean(design.hypertune) : null,
        Memories: memories,
      };
      if (design.weapon.templateId) {
        body.Weapon = {
          TemplateId: design.weapon.templateId,
          Level: design.weapon.level,
          Resonance: (design.weaponResonances || []).map((templateId, index) => (templateId
            ? { Slot: index + 1, Type: "weapon", TemplateId: templateId }
            : null)).filter(Boolean),
          HarmonySuit: design.weapon.harmonySuit || 0,
        };
      }
      return body;
    }

    async function write(body, label) {
      const note = $("#tuneNote");
      note.textContent = "writing…";
      try {
        const response = await fetch("/api/panel/tune", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.msg || "the tune was refused");
        const report = payload.data || {};
        // One resonance on a memory is legal, but it is the difference between a finished build and a
        // half one, so the note says which slots were written with a single slot instead of leaving it
        // to be noticed in game. It reads the report the server answered with, not the form.
        const written = report.memories || report.Memories || [];
        const single = written.filter((memory) => (memory.resonance || memory.Resonance || []).length < 2);
        const slots = single.map((memory) => memory.slot || memory.Slot).join(", ");
        note.textContent = `wrote ${label}`
          + (single.length > 0 ? ` · ${single.length} of ${written.length} memories kept one resonance (slot ${slots})` : "")
          + (payload.live === false ? " · stored in the database, the client shows it at its next login" : "");
        log("tune", ["character", String(state.characterId)], true, JSON.stringify(report, null, 2));
        $("#tuneModal").hidden = true;
        await select(state.characterId);
      } catch (error) {
        note.textContent = error.message;
        log("tune", ["character", String(state.characterId)], false, error.message);
      } finally {
        window.SelenaUI.initTooltips();
      }
    }

    $("#tunePerform").addEventListener("click", function () {
      // the modal keeps its own design object on the element so Perform reads what the sliders show
      const design = state.modalDesign;
      if (!design) return;
      write(payload(design), "the designed build");
    });

    document.querySelectorAll("[data-close='tune']").forEach((node) => {
      node.addEventListener("click", function () { $("#tuneModal").hidden = true; });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeModals();
    });

    // the section renders the empty state until a construct is picked
    card.appendChild(rows([["Construct", "pick one to see its build"]]));
  }

  /* ---------------------------------------------------------------- tutti */

  function closeModals() {
    document.querySelectorAll(".modal").forEach(function (node) { node.hidden = true; });
  }

  function bulkArgs(section) {
    /* The modal owns the amount, so a user who never touches the section form still gets the count they
     * typed here. The form's own fields only feed Perform. */
    var input = $("#tuttiAmount");
    var merged = Object.assign({}, values);
    if (section.bulkAmount && input) merged[section.bulkAmount] = String(input.value || "1");
    return section.allArgs(merged).map(String);
  }

  function bulkPreview(section) {
    try { return section.command + " " + bulkArgs(section).join(" "); } catch (err) { return section.command; }
  }

  async function runBulk(args) {
    var newline = String.fromCharCode(10);
    var section = SECTIONS[current];
    if (!section || !args || args.length === 0) return;
    var button = $("#allBtn");
    var cmd = { name: section.command, args: args };
    button.disabled = true;
    $("#meter").dataset.state = "running";
    try {
      var response = await command(cmd.name, cmd.args);
      performed += 1;
      var detail = (response && response.data) ? JSON.stringify(response.data, null, 2) : (response && response.msg) || "OK";
      if (response && response.live === false) detail += newline + "stored in the database - the game client shows it at its next login";
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, true, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      celebrate(button);
      window.SelenaAudio.chord();
    } catch (err) {
      performed += 1;
      var failure = (err && (err.message || String(err))) || "Request failed";
      if (err && err.data) failure += newline + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, failure);
      $("#consoleMeta").textContent = opusLabel(performed);
      window.SelenaAudio.low();
    } finally {
      $("#meter").dataset.state = "idle";
      button.disabled = false;
      updatePreview();
    }
  }

  function openTutti() {
    var section = SECTIONS[current];
    if (!section || typeof section.allArgs !== "function") return;
    if (!actingUid()) {
      $("#runHint").textContent = "pick an acting account";
      return;
    }

    $("#tuttiTitle").textContent = section.title + " · Tutti";
    var body = $("#tuttiBody");
    body.textContent = "";

    var lead = document.createElement("p");
    lead.className = "tutti__lead";
    lead.textContent = "Tutti runs " + section.title + " for every entry at once, not for the one picked in the form. "
      + "Nothing is granted until you press Perform here.";
    body.appendChild(lead);

    if (section.bulkAmount) {
      var descriptor = (section.fields || []).filter(function (field) { return field.key === section.bulkAmount; })[0] || {};
      var field = document.createElement("label");
      field.className = "field";
      var caption = document.createElement("span");
      caption.className = "field__label";
      caption.textContent = "Amount";
      var hint = document.createElement("span");
      hint.className = "field__hint";
      hint.textContent = "how many of each entry to grant";
      caption.appendChild(hint);
      var input = document.createElement("input");
      input.className = "input";
      input.id = "tuttiAmount";
      input.type = "number";
      input.min = String(descriptor.min || 1);
      input.max = String(descriptor.max || 99);
      input.value = String(values[section.bulkAmount] || "1");
      input.addEventListener("input", function () { $("#tuttiNote").textContent = bulkPreview(section); });
      field.append(caption, input);
      body.appendChild(field);
    }

    $("#tuttiNote").textContent = bulkPreview(section);
    $("#tuttiModal").hidden = false;
    $("#tuttiPerform").focus();
  }

  /* ---------------------------------------------------------------- wiring */

  document.querySelectorAll(".rail__item[data-section]").forEach(function (el) {
    el.addEventListener("click", function () { renderSection(el.dataset.section); });
  });

  $("#actionForm").addEventListener("submit", perform);

  $("#allBtn").addEventListener("click", openTutti);

  $("#tuttiPerform").addEventListener("click", function () {
    var section = SECTIONS[current];
    if (!section) return;
    var args = bulkArgs(section);
    closeModals();
    runBulk(args);
  });
  $("#tuttiCancel").addEventListener("click", closeModals);

  $("#bulkPerform").addEventListener("click", function () {
    closeModals();
    if (bulkPerformHandler) bulkPerformHandler();
  });
  $("#bulkCancel").addEventListener("click", closeModals);
  document.querySelectorAll("[data-close='bulk']").forEach(function (node) {
    node.addEventListener("click", closeModals);
  });
  document.querySelectorAll("[data-close='tutti']").forEach(function (node) {
    node.addEventListener("click", closeModals);
  });

  $("#clearBtn").addEventListener("click", function () {
    performed = 0;
    opus += 1;
    window.SelenaAudio.low();
    $("#consoleMeta").textContent = opusLabel(0);
    window.SelenaUI.resetLog($("#consoleList"), "The stage is quiet",
      "Commandant, write the first note of our duet: choose a target and perform.");
  });

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") perform(event);
  });

  // Bound once: the list is rebuilt on changes, and a listener added inside that rebuild would stack.
    $("#accountSelect").addEventListener("change", function () {
      syncAccountMirror();
      selectAccount(accountList);
    });

    loadAccounts();
    setInterval(loadAccounts, 5000);
  window.addEventListener("focus", loadAccounts);
  renderSection("items");
  /* One delegated listener: rail clicks are re-rendered often, so binding per
   * element would stack handlers and play several plucks at once. */
  var railSoundBound = true;
  document.addEventListener("click", function (event) {
    var item = event.target.closest(".rail__item[data-section]");
    if (!item) return;
    var index = Number(item.dataset.railIndex || 0);
    window.SelenaAudio.pluck(RAIL_SCALE[index % RAIL_SCALE.length]);
  });

  initRailTips();
  initSound();

  /* Static controls get their own explanation, because these are exactly the
   * buttons people guess at. */
  var CONTROLS = {
    runBtn: "Perform this tab's command for the acting account. Ctrl + Enter does the same.",
    clearBtn: "Clear the performance log and start a new opus. Nothing is sent to the server."
  };

  Object.keys(CONTROLS).forEach(function (id) {
    var el = document.querySelector("#" + id);
    if (el) el.setAttribute("data-tip", CONTROLS[id]);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".rail__item[data-state='unavailable']"), function (el) {
    el.setAttribute("data-tip", "No command backs this yet: it needs a server-side handler, specified in docs/stage-b.md.");
  });

  Array.prototype.forEach.call(document.querySelectorAll(".unavailable__row"), function (row) {
    row.setAttribute("data-tip", "No command backs this yet: it needs a server-side handler, specified in docs/stage-b.md.");
  });

  $("#consoleMeta").textContent = opusLabel(0);

})();
