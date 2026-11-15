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

  var SECTIONS = {
    items: {
      title: "Items",
      command: "item",
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
      fields: [{ key: "equip", type: "grid", catalog: "weapons", label: "Weapon", placeholder: "Search weapon name or ID", required: true }],
      build: function (v) { return ["add", v.equip.id]; },
      allArgs: function () { return ["add", "all"]; }
    },
    memories: {
      title: "Memories",
      command: "equip",
      fields: [
        { key: "set", type: "select", label: "Memory set", hint: "all six slots at once", placeholder: "None — pick one memory below",
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
      allArgs: function () { return ["add", "all"]; }
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
  var SECTION_TIPS = {
    items: "Grant items to the selected account. The amount is the stack size the server receives.",
    characters: "Unlock a construct. The server grants it at the level it decides, not a copy of someone else's.",
    weapons: "Grant weapons by star. Equipped slots stay untouched.",
    memories: "Grant memories by star. Equipped slots stay untouched.",
    coatings: "Unlock every coating that belongs to the chosen construct.",
    scenes: "Unlock scene backgrounds and lobby views for the account.",
    stages: "Unlock stages and bosses so they can be selected in game.",
    commandant: "Set the Commandant level, the account-wide progression value shown in your profile.",
    bc: "Send a broadcast payload to the account's in-game mailbox.",
    cleanup: "Remove duplicates and low-star leftovers from your inventory. Preview first; nothing is deleted until you confirm."
  };

  /* One note per rail entry, ascending: a C major scale is exactly seven steps,
   * so every section sounds different instead of wrapping back after four. */
  var RAIL_SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];

  function initRailTips() {
    var items = document.querySelectorAll(".rail__item[data-section]");
    Array.prototype.forEach.call(items, function (el, index) {
      var key = el.getAttribute("data-section");
      if (key && SECTION_TIPS[key]) el.setAttribute("data-tip", SECTION_TIPS[key]);
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

  /* The list comes from the server's admin endpoints, so it appears as soon as the server runs:
   * nothing here needs a signed-in game session. */
  async function loadAccounts() {
    var select = $("#accountSelect");

    try {
      var response = await fetch("/api/panel/accounts", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      var payload = await response.json();
      var accounts = (payload && payload.accounts) || [];

      if (accounts.length === 0) {
        select.parentElement.hidden = true;
        fillPreviewPlaceholder("no account in the database yet - create one from the Accounts tab");
        return;
      }

      var stored = null;
      try { stored = JSON.parse(localStorage.getItem("selena.activeAccount") || "null"); } catch (error) { stored = null; }

      select.textContent = "";
      accounts.forEach(function (account) {
        var option = document.createElement("option");
        option.value = String(account.uid);
        option.textContent = account.username + " · UID " + account.uid + (account.playerPresent ? "" : " · no player yet");
        select.appendChild(option);
      });

      select.value = stored && accounts.some(function (a) { return String(a.uid) === String(stored.uid); })
        ? String(stored.uid)
        : String(accounts[0].uid);

      selectAccount(accounts);
      select.addEventListener("change", function () { selectAccount(accounts); });
    } catch (error) {
      select.parentElement.hidden = true;
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

    var devRow = document.createElement("label");
    devRow.className = "check";
    var devBox = document.createElement("input");
    devBox.type = "checkbox";
    devBox.addEventListener("change", function () {
      state.developed = devBox.checked;
      state.token = null;
      reset();
    });
    devRow.appendChild(devBox);
    devRow.appendChild(document.createTextNode("Also delete levelled and promoted entries"));

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
      var select = document.createElement("select");
      select.className = "input";
      select.setAttribute("aria-label", field.label || "");
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = field.placeholder || "None";
      select.appendChild(placeholder);
      values[field.key] = "";

      (field.options || function () { return Promise.resolve([]); })()
        .then(function (list) {
          (list || []).forEach(function (item) {
            var option = document.createElement("option");
            option.value = String(item.value);
            option.textContent = item.label;
            select.appendChild(option);
          });
        })
        .catch(function () { /* placeholder stays; Perform has nothing to send */ });

      select.addEventListener("change", function () {
        values[field.key] = select.value;
        bump();
      });
      wrap.appendChild(select);
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

    /* Tutti exists only where a section can speak for every entry at once. It arms on the first
     * press and fires on the second one inside five seconds; the shared button never carries a
     * half-armed state into the next section. */
    var allBtn = $("#allBtn");
    var hasAll = typeof section.allArgs === "function" && !isCustom;
    allBtn.hidden = !hasAll;
    allBtn.disabled = false;
    disarmAll();
    if (hasAll) {
      allBtn.setAttribute("data-tip", "Tutti: apply this tab to every entry at once. Press twice to confirm.");
      allBtn.setAttribute("aria-label", "Tutti: run this command for every entry (press twice)");
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

  /* ---------------------------------------------------------------- tutti */

  var allArmed = false;
  var allTimer = null;

  function disarmAll(reason) {
    allArmed = false;
    clearTimeout(allTimer);
    var button = $("#allBtn");
    if (button) {
      button.classList.remove("is-armed");
      button.textContent = "Tutti · all";
    }
    /* Only the timeout is a real event worth a sound; changing section is not. */
    if (reason === "timeout" && window.SelenaAudio) window.SelenaAudio.standDown();
  }

  async function performAll() {
    var section = SECTIONS[current];
    if (!section || typeof section.allArgs !== "function") return;

    var button = $("#allBtn");

    if (!allArmed) {
      allArmed = true;
      button.classList.add("is-armed");
      button.textContent = "Tutti · press again";
      window.SelenaAudio.arm();
      allTimer = setTimeout(function () { disarmAll("timeout"); }, 5000);
      return;
    }

    disarmAll("confirm");

    if (!actingUid()) {
      $("#runHint").textContent = "pick an acting account";
      return;
    }

    var cmd = { name: section.command, args: section.allArgs(values).map(String) };
    button.disabled = true;
    $("#meter").dataset.state = "running";

    try {
      var response = await command(cmd.name, cmd.args);
      performed += 1;
      var detail = (response && response.data) ? JSON.stringify(response.data, null, 2) : (response && response.msg) || "OK";
      if (response && response.live === false) detail += "\nstored in the database - the game client shows it at its next login";
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, true, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      celebrate(button);
      window.SelenaAudio.chord();
    } catch (err) {
      performed += 1;
      var failure = (err && (err.message || String(err))) || "Request failed";
      if (err && err.data) failure += "\n" + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, failure);
      $("#consoleMeta").textContent = opusLabel(performed);
      window.SelenaAudio.low();
    } finally {
      $("#meter").dataset.state = "idle";
      button.disabled = false;
      updatePreview();
    }
  }

  /* ---------------------------------------------------------------- wiring */

  document.querySelectorAll(".rail__item[data-section]").forEach(function (el) {
    el.addEventListener("click", function () { renderSection(el.dataset.section); });
  });

  $("#actionForm").addEventListener("submit", perform);

  $("#allBtn").addEventListener("click", performAll);

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

  loadAccounts();
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
