/* Selena-port GM console.
 *
 * Every action is one AscNet chat command (AscNet.GameServer/Commands), executed
 * through the SDK server with the signed-in account's token. The performance log
 * shows exactly what the server answered; the picker, stepper and log rendering
 * come from common/ui.js so both panels stay identical.
 */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

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
      /* Nothing chosen means nothing to do; a set grants its six slots, a single memory
       * grants itself, and the amount is the copy count in both cases. */
      plan: function (v) {
        var qty = String(v.qty || 1);
        if (v.set) {
          var set = memorySetsCache.filter(function (entry) { return String(entry.id) === String(v.set); })[0];
          if (!set) return [];
          return set.slots.map(function (slot) {
            return { name: "equip", args: ["add", String(slot.id), qty] };
          });
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


  /* ---------------------------------------------------------------- account */

  function renderAccount() {
    // Nothing to paint: the sign-in footer is gone and the acting account is chosen from the
    // database picker instead.
    var status = $("#connStatus");
    var text = $("#connText");
    if (!status || !text) return;

    var acc = window.SelenaAPI.account;
    var label = $("#accountLabel");
    var btn = $("#accountBtn");

    if (acc) {
      status.classList.add("is-online");
      status.classList.remove("is-offline");
      text.textContent = "Signed in";
      label.textContent = acc.username + " · UID " + acc.uid;
      label.title = "UID " + acc.uid;
      btn.textContent = "Sign out";
    } else {
      status.classList.remove("is-online");
      status.classList.add("is-offline");
      text.textContent = "Signed out";
      label.textContent = "No account";
      label.removeAttribute("title");
      btn.textContent = "Sign in";
    }

    updatePreview();
  }

  async function signIn() {
    try {
      await window.SelenaAPI.promptLogin();
    } catch (err) {
      /* cancelled */
    }
    renderAccount();
    refreshStatus();
  }

  /* Ask the server whether this account actually has a live session. */
  async function refreshStatus() {
    var status = $("#connStatus");
    var text = $("#connText");
    if (!window.SelenaAPI.account) return;

    var result = await window.SelenaAPI.status();
    if (result.state === "in-game") {
      status.classList.add("is-online");
      status.classList.remove("is-offline");
      text.textContent = "In game";
      if (status) status.setAttribute("data-tip", "Live session: the server accepted a save probe for this account.");
    } else if (result.state === "not-in-game") {
      status.classList.remove("is-online");
      status.classList.add("is-offline");
      text.textContent = "Not in game";
      if (status) status.setAttribute("data-tip", "No live session: the game is not connected, so commands will fail until you log in there.");
    } else if (result.state === "account-only") {
      status.classList.remove("is-online");
      status.classList.add("is-offline");
      text.textContent = "Account ready · game login required";
      if (status) status.setAttribute("data-tip", "This account exists, but the server only authorises commands for a player the game has created. Log in from the client once, then commands work.");
    } else if (result.state === "signed-out") {
      renderAccount();
    }
  }

  /* ---------------------------------------------------------------- catalogs */


  // A memory set is six records, one per slot; slot layouts differ per construct.
  async function grantMemorySet(set, copies) {
    var amount = Math.max(1, copies || 1);
    var results = [];
    for (var i = 0; i < set.slots.length; i += 1) {
      var slot = set.slots[i];
      var ok = true;
      var error = "";
      for (var copy = 0; copy < amount && ok; copy += 1) {
        try {
          await window.SelenaAPI.command("equip", ["add", String(slot.id)]);
        } catch (err) {
          ok = false;
          error = (err && err.message) || "Request failed";
        }
      }
      results.push({ site: slot.site, id: slot.id, ok: ok, error: error });
    }
    return results;
  }

  async function catalog(kind) {
    if (catalogCache[kind]) return catalogCache[kind];
    var entries = await window.SelenaAPI.catalog(kind);
    catalogCache[kind] = entries;
    return entries;
  }

  /* ---------------------------------------------------------------- sections */



  /* Two-press confirmation for bulk actions inside custom sections, matching the
   * rail's Tutti button: arm, then confirm within five seconds, with the same cues. */
  function armButton(button, label, onConfirm) {
    var armed = false;
    var timer = null;
    button.type = "button";
    button.className = "btn btn--quiet";
    button.textContent = label + " · all";

    function reset() {
      armed = false;
      clearTimeout(timer);
      button.classList.remove("is-armed");
      button.textContent = label + " · all";
    }

    button.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        button.classList.add("is-armed");
        button.textContent = label + " · press again";
        window.SelenaAudio.arm();
        timer = setTimeout(function () { reset(); window.SelenaAudio.standDown(); }, 5000);
        return;
      }
      reset();
      onConfirm();
    });

    return button;
  }

  /* Section-specific buttons are gone: every section now declares fields and a build, and
   * Perform runs it. The row only has to be cleared in case a custom renderer added buttons. */
  var sectionActions = {
    clear: function () {
      var row = $("#sectionActions");
      if (!row) return;
      [...row.querySelectorAll("[data-section-action]")].forEach(function (button) { button.remove(); });
      var holder = row.querySelector("[data-section-holder]");
      if (holder) holder.textContent = "";
    },
  };

  var fieldNodes = {};
  var memorySetsCache = [];

  /* Coatings are per construct, so the catalog is fetched for the construct that is picked
   * rather than for the whole table. */
  async function loadCoatings(owner) {
    if (!owner) return [];
    var response = await fetch("/api/panel/coatings/" + owner);
    if (!response.ok) return [];
    var payload = await response.json();
    // The endpoint answers { characterId, count, entries }, each entry { id, name, meta }.
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
      // The bundled element when the page has it, the factory control otherwise: the panel draws
      // its own dropdown either way, a native popup is the one OS control left.
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
        .catch(function () { /* the placeholder stays, so Perform simply has nothing to do */ });

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

  /* A field that reads another field's choice is rebuilt when that choice changes, so the
   * coating catalog follows the construct instead of showing everything at once. */
  function bump() {
    var section = SECTIONS[current];
    if (!section) return;

    // Sync picks into values first: a dependent field reads the value of the field it follows.
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

      // Rebuild only when the field it depends on actually changed. Rebuilding on every
      // change wiped the selection the player had just made in this very grid.
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

    document.querySelectorAll(".rail__item").forEach(function (el) {
      if (el.dataset.section === key) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    $("#sectionTitle").textContent = section.title;
    sectionActions.clear();

    var host = $("#formFields");
    host.textContent = "";

    var isCustom = Boolean(section.custom);
    $("#preview").hidden = isCustom;
    $("#runBtn").hidden = isCustom;
    var gmPreviewLabel = document.querySelector("#previewLabel");
    if (gmPreviewLabel) gmPreviewLabel.hidden = isCustom;
    $("#allBtn").hidden = true;

    section.fields.forEach(function (field) {
      var wrap = document.createElement("label");
      wrap.className = "field";
      fieldNodes[field.key] = { wrap: wrap };
      fieldControl(field, wrap);
      host.appendChild(wrap);
    });

    var allBtn = $("#allBtn");
    var hasAll = typeof section.allArgs === "function" && !section.custom;
    allBtn.hidden = !hasAll;
    allBtn.disabled = false;
    allBtn.textContent = "Tutti · all";
    allBtn.classList.remove("is-armed");
    if (hasAll) {
      allBtn.setAttribute("data-tip", "Tutti: apply this tab to every entry at once. Opens a short form with its own amount.");
      allBtn.setAttribute("aria-label", "Tutti: run this command for every entry");
    }

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
      var first = comboField.catalogFrom
        ? comboField.catalogFrom(values)
        : catalog(comboField.catalog);
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

  /* ---------------------------------------------------------------- score */

  /* One Perform can mean several commands: a memory set is six records, and the command
   * layer takes one id per call. A section returns the whole plan and Perform walks it. */
  function buildPlan() {
    var section = SECTIONS[current];
    if (!section) return [];

    section.fields.forEach(function (field) {
      if (field.type !== "combo" && field.type !== "grid") return;
      var pick = picks[field.key] && picks[field.key].value();
      values[field.key] = pick || null;
    });

    if (typeof section.plan === "function") {
      return section.plan(values) || [];
    }

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
    $("#runHint").textContent = window.SelenaAPI.account ? "" : "sign in to perform";
  }

  /* ---------------------------------------------------------------- perform */


  /* ---------------------------------------------------------------- grant all */

  /* Every catalog command also accepts "all". It is a bulk write, so the button
   * arms on the first press and only fires on the second one inside five
   * seconds - no dialog, no silent mass grant. */
  /* Tutti opens a modal that states what it does and carries the bulk amount; nothing fires from the
   * button alone, which is what the two-press arm used to stand in for. */
  function closeModals() {
    document.querySelectorAll(".modal").forEach(function (node) { node.hidden = true; });
  }

  function bulkArgs(section) {
    var input = $("#tuttiAmount");
    var merged = Object.assign({}, values);
    if (section.bulkAmount && input) merged[section.bulkAmount] = String(input.value || "1");
    return section.allArgs(merged).map(String);
  }

  function bulkPreview(section) {
    try { return section.command + " " + bulkArgs(section).join(" "); } catch (err) { return section.command; }
  }

  async function runBulk(section, args) {
    var button = $("#allBtn");
    var newline = String.fromCharCode(10);
    if (!window.SelenaAPI.account) {
      await signIn();
      if (!window.SelenaAPI.account) return;
    }

    var cmd = { name: section.command, args: args };
    button.disabled = true;
    $("#meter").dataset.state = "running";

    try {
      var response = await window.SelenaAPI.command(cmd.name, cmd.args);
      performed += 1;
      renderAccount();
      refreshStatus();
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, true, JSON.stringify(response, null, 2));
      $("#consoleMeta").textContent = opusLabel(performed);
      celebrate(button);
      window.SelenaAudio.chord();
    } catch (err) {
      performed += 1;
      var detail = (err && (err.message || String(err))) || "Request failed";
      if (err && err.data) detail += newline + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      refreshStatus();
    } finally {
      $("#meter").dataset.state = "idle";
      button.disabled = false;
    }
  }

  function openTutti() {
    var section = SECTIONS[current];
    if (!section || typeof section.allArgs !== "function") return;

    $("#tuttiTitle").textContent = section.title + " \u00b7 Tutti";
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

  async function perform(event) {
    if (event) event.preventDefault();

    var plan = buildPlan();
    if (plan.length === 0) return;

    if (!window.SelenaAPI.account) {
      await signIn();
      if (!window.SelenaAPI.account) return;
    }

    var run = $("#runBtn");
    run.disabled = true;
    run.textContent = "Performing…";
    $("#meter").dataset.state = "running";

    var lines = [];
    var failures = 0;

    try {
      for (var i = 0; i < plan.length; i += 1) {
        var step = plan[i];
        try {
          var response = await window.SelenaAPI.command(step.name, step.args);
          lines.push("/" + step.name + " " + step.args.join(" ") + " -> " + ((response && response.msg) || "OK"));
        } catch (stepError) {
          failures += 1;
          lines.push("/" + step.name + " " + step.args.join(" ") + " -> " + ((stepError && stepError.message) || "failed"));
        }
      }

      performed += 1;
      renderAccount();
      refreshStatus();
      var summary = { name: plan[0].name, args: plan[0].args };
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, summary, failures === 0, lines.join("\n"));
      $("#consoleMeta").textContent = opusLabel(performed);

      if (failures === 0) {
        celebrate(run);
        window.SelenaAudio.chord();
      } else {
        window.SelenaAudio.low();
      }
    } finally {
      $("#meter").dataset.state = "idle";
      run.textContent = "Perform";
      run.disabled = false;
      updatePreview();
    }
  }

  /* ---------------------------------------------------------------- wiring */

  document.querySelectorAll(".rail__item").forEach(function (el) {
    el.addEventListener("click", function () { renderSection(el.dataset.section); });
  });

  // The sign-in button is gone from this console, so this wiring must not assume it exists.
  var accountButton = $("#accountBtn");
  if (accountButton) {
    accountButton.addEventListener("click", function () {
      if (window.SelenaAPI.account) {
        window.SelenaAPI.logout();
        renderAccount();
      } else {
        signIn();
      }
    });
  }

  $("#allBtn").addEventListener("click", openTutti);
  $("#tuttiPerform").addEventListener("click", function () {
    var section = SECTIONS[current];
    if (!section) return;
    var args = bulkArgs(section);
    closeModals();
    runBulk(section, args);
  });
  $("#tuttiCancel").addEventListener("click", closeModals);
  document.querySelectorAll("[data-close='tutti']").forEach(function (node) {
    node.addEventListener("click", closeModals);
  });
  $("#actionForm").addEventListener("submit", perform);

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

  renderAccount();
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
    runBtn: "Send this command to the server. Ctrl + Enter does the same.",
    clearBtn: "Clear the performance log and start a new opus. Nothing is sent to the server.",
    accountBtn: "Sign in with a local server account, or sign out of this panel."
  };

  Object.keys(CONTROLS).forEach(function (id) {
    var el = document.querySelector("#" + id);
    if (el) el.setAttribute("data-tip", CONTROLS[id]);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".unavailable__row"), function (row) {
    row.setAttribute("data-tip", "No command backs this yet: it needs a server-side handler, specified in docs/stage-b.md.");
  });

  $("#consoleMeta").textContent = opusLabel(0);
  if (window.SelenaAPI.account) refreshStatus();

  /* Keep the rail honest without waiting for an action: poll the server while the
   * tab is visible, and first refresh any session that predates the client's first
   * login so an old tab becomes usable on its own. */
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (!window.SelenaAPI.account) return;

    var acc = window.SelenaAPI.account();
    if (!acc.playerToken) {
      window.SelenaAPI.verify().then(function (next) {
        if (next) refreshStatus();
      }).catch(function () { /* stay signed in; the next poll retries */ });
      return;
    }

    refreshStatus();
  }, 10000);

})();

  // ------------------------------------------------------------ account picker
  // The list comes from the server's admin endpoints, so it appears as soon as the
  // server runs; nothing here requires a signed-in game session.
  /* The acting account picker is the panel's own dropdown and the only control: there is no hidden
   * native select behind it, so the visible label always comes from the account list itself. */
  var accountPicker = null;

  function paintAccountPicker(accounts, value) {
    var host = document.getElementById("accountPicker");
    if (!host) return;

    var native = document.getElementById("accountSelect");
    var options = accounts.map(function (account) {
      return { value: String(account.uid), label: account.username + " / UID " + account.uid };
    });

    if (!accountPicker) {
      // The bundled element when the page has it, the factory otherwise: one control either way.
      accountPicker = window.SelenaUI.picker([], {
        value: value,
        search: "Filter accounts",
        onChange: function (picked) {
          var chosen = accounts.filter(function (account) { return String(account.uid) === String(picked); })[0];
          if (chosen) localStorage.setItem("selena.activeAccount", JSON.stringify({ uid: chosen.uid, username: chosen.username }));
          if (native) native.value = String(picked);
        },
      });
      host.appendChild(accountPicker.node);

      // Whatever is in front, the native select only holds the value and never shows.
      if (native) {
        native.classList.add("is-mirrored");
        native.tabIndex = -1;
        native.setAttribute("aria-hidden", "true");
      }
    }

    accountPicker.setOptions(options, value);
  }

  function initAccountSelector() {
    // The native select stays until the custom picker is proven here: it is the one control that
    // cannot be allowed to go blank.
    var select = document.getElementById("accountSelect");
    if (!select) return;

    fetch("/api/panel/accounts")
      .then(function (response) { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then(function (payload) {
        var accounts = (payload && payload.accounts) || [];
        if (accounts.length === 0) { select.parentElement.hidden = true; return; }

        accounts.forEach(function (account) {
          var option = document.createElement("option");
          option.value = String(account.uid);
          option.textContent = account.username + " / UID " + account.uid;
          select.appendChild(option);
        });

        var stored = null;
        try { stored = JSON.parse(localStorage.getItem("selena.activeAccount") || "null"); } catch (error) { stored = null; }
        var chosen = stored && accounts.some(function (a) { return String(a.uid) === String(stored.uid); })
          ? String(stored.uid)
          : String(accounts[0].uid);

        select.value = chosen;
        select.addEventListener("change", function () {
          var picked = accounts.filter(function (a) { return String(a.uid) === select.value; })[0];
          if (picked) localStorage.setItem("selena.activeAccount", JSON.stringify({ uid: picked.uid, username: picked.username }));
        });

        paintAccountPicker(accounts, chosen);
        var start = accounts.filter(function (a) { return String(a.uid) === chosen; })[0];
        if (start) localStorage.setItem("selena.activeAccount", JSON.stringify({ uid: start.uid, username: start.username }));
      })
      .catch(function () { select.parentElement.hidden = true; });
  }

  document.addEventListener("DOMContentLoaded", initAccountSelector);
