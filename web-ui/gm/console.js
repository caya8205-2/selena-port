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
      fields: [
        { key: "item", type: "combo", catalog: "items", label: "Item", placeholder: "Search item name or ID", required: true },
        { key: "qty", type: "number", label: "Amount", value: "1", min: 1, max: 99999, hint: "server clamps to the item limit" }
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
    equipment: {
      title: "Equipment",
      command: "equip",
      fields: [{ key: "equip", type: "grid", catalog: "equips", label: "Equipment", placeholder: "Search weapon or memory, or filter by star", required: true }],
      build: function (v) { return ["add", v.equip.id]; },
      allArgs: function () { return ["add", "all"]; }
    },
    coatings: {
      title: "Coatings",
      command: "coating",
      custom: "coatings"
    },
    scenes: {
      title: "Scenes",
      command: "scene",
      fields: [],
      note: "Unlocks every scene background in the catalog. The command layer has no per-scene selection yet.",
      build: function () { return ["unlock", "all"]; }
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
  var SECTION_TIPS = {
    items: "Grant items to the selected account. The amount is the stack size the server receives.",
    characters: "Unlock a construct. The server grants it at the level it decides, not a copy of someone else's.",
    equipment: "Grant weapons and memories by star. Equipped slots stay untouched.",
    coatings: "Unlock every coating that belongs to the chosen construct.",
    scenes: "Unlock scene backgrounds and lobby views for the account.",
    stages: "Unlock stages and bosses so they can be selected in game.",
    commandant: "Set the Commandant level, the account-wide progression value shown in your profile.",
    bc: "Send a broadcast payload to the account's in-game mailbox."
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


  /* ---------------------------------------------------------------- account */

  function renderAccount() {
    var acc = window.SelenaAPI.account;
    var status = $("#connStatus");
    var text = $("#connText");
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
    } else if (result.state === "signed-out") {
      renderAccount();
    }
  }

  /* ---------------------------------------------------------------- catalogs */

  async function catalog(kind) {
    if (catalogCache[kind]) return catalogCache[kind];
    var entries = await window.SelenaAPI.catalog(kind);
    catalogCache[kind] = entries;
    return entries;
  }

  /* ---------------------------------------------------------------- sections */


  /* ---------------------------------------------------------------- coatings */

  /* Two dependent pickers: the construct, then the coatings that belong to that
   * construct (read from the fashion table per character). Unlocking one coating
   * sends "coating unlock <characterId> <coatingId>"; the per-character bulk stays
   * available for when the whole wardrobe is wanted. */
  function renderCoatings(host) {
    var owner = null;
    var coating = null;
    var ownerGrid;
    var coatingHost = document.createElement("div");
    coatingHost.className = "field";

    var coatingLabel = document.createElement("span");
    coatingLabel.className = "field__label";
    coatingLabel.innerHTML = 'Coating<span class="field__hint">every coating of this construct</span>';
    coatingHost.appendChild(coatingLabel);

    var coatingBody = document.createElement("div");
    coatingHost.appendChild(coatingBody);

    var actions = document.createElement("div");
    actions.className = "cleanup__actions";

    var unlockBtn = document.createElement("button");
    unlockBtn.type = "button";
    unlockBtn.className = "btn btn--primary";
    unlockBtn.textContent = "Unlock coating";
    unlockBtn.disabled = true;

    var unlockAllBtn = document.createElement("button");
    unlockAllBtn.type = "button";
    unlockAllBtn.className = "btn btn--quiet";
    unlockAllBtn.textContent = "Unlock every coating";
    unlockAllBtn.disabled = true;

    actions.appendChild(unlockBtn);
    actions.appendChild(unlockAllBtn);

    var status = document.createElement("p");
    status.className = "hint-block";
    status.textContent = "Pick a construct first.";

    ownerGrid = window.SelenaUI.grid(
      { label: "Construct", catalog: "characters", placeholder: "Search construct, trade name or ID" },
      function () { return catalog("characters"); },
      function () {
        owner = ownerGrid.value();
        coating = null;
        unlockBtn.disabled = true;
        unlockAllBtn.disabled = !owner;
        coatingBody.textContent = "";

        if (!owner) {
          status.textContent = "Pick a construct first.";
          return;
        }

        status.textContent = "Loading coatings…";
        var grid = window.SelenaUI.grid(
          { label: "Coating", placeholder: "Search coating name or id" },
          function () { return window.SelenaAPI.coatings(owner.id); },
          function () {
            coating = grid.value();
            unlockBtn.disabled = !coating;
          }
        );
        grid.node.querySelector(".grid__status").textContent = "";

        window.SelenaAPI.coatings(owner.id).then(function (entries) {
          status.textContent = owner.name + " · " + entries.length + (entries.length === 1 ? " coating" : " coatings");
        }).catch(function () {
          status.textContent = "Could not read the coating catalog.";
        });

        coatingBody.appendChild(grid.node);
      }
    );

    host.appendChild(ownerGrid.node);
    host.appendChild(coatingHost);
    host.appendChild(actions);
    host.appendChild(status);

    function entryFor(args, ok, detail) {
      performed += 1;
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, { name: "coating", args: args }, ok, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      if (ok) { celebrate(unlockBtn); window.SelenaAudio.chord(); } else { window.SelenaAudio.low(); }
      refreshStatus();
    }

    async function send(args, button) {
      button.disabled = true;
      $("#meter").dataset.state = "running";
      try {
        var response = await window.SelenaAPI.command("coating", args);
        entryFor(args, true, (response && response.msg) || "OK");
      } catch (err) {
        entryFor(args, false, (err && err.message) || "Request failed");
      } finally {
        $("#meter").dataset.state = "idle";
        button.disabled = button === unlockBtn ? !coating : !owner;
      }
    }

    unlockBtn.addEventListener("click", function () {
      if (!owner || !coating) return;
      send(["unlock", owner.id, coating.id], unlockBtn);
    });

    unlockAllBtn.addEventListener("click", function () {
      if (!owner) return;
      send(["unlock", owner.id], unlockAllBtn);
    });
  }

  function renderSection(key) {
    current = key;
    values = {};
    picks = {};

    var section = SECTIONS[key];

    document.querySelectorAll(".rail__item").forEach(function (el) {
      if (el.dataset.section === key) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    $("#sectionTitle").textContent = section.title;

    var host = $("#formFields");
    host.textContent = "";

    /* Custom sections own their actions: the generic score line, Perform and the
     * bulk button step aside so no control is left pointing at nothing. */
    var isCustom = Boolean(section.custom);
    $("#preview").hidden = isCustom;
    $("#runBtn").hidden = isCustom;
    var gmPreviewLabel = document.querySelector("#previewLabel");
    if (gmPreviewLabel) gmPreviewLabel.hidden = isCustom;
    disarmAll();
    $("#allBtn").hidden = true;

    if (section.custom === "coatings") {
      renderCoatings(host);
      return;
    }

    section.fields.forEach(function (field) {
      var wrap = document.createElement("label");
      wrap.className = "field";

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
        var picker = window.SelenaUI.combo(field, function () { return catalog(field.catalog); }, updatePreview);
        picks[field.key] = picker;
        wrap.appendChild(picker.node);
      } else if (field.type === "grid") {
        var gallery = window.SelenaUI.grid(field, function () { return catalog(field.catalog); }, updatePreview);
        picks[field.key] = gallery;
        wrap.appendChild(gallery.node);
      } else {
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
          updatePreview();
        });
        wrap.appendChild(field.type === "number"
          ? window.SelenaUI.stepper(input, field, updatePreview)
          : input);
      }

      host.appendChild(wrap);
    });

    /* Sections that accept an "all" form get the bulk button; the rest keep it
     * hidden rather than showing a control that cannot do anything. */
    var allBtn = $("#allBtn");
    var hasAll = typeof section.allArgs === "function";
    allBtn.hidden = !hasAll;
    allBtn.disabled = false;
    allBtn.textContent = "Tutti · all";
    allBtn.classList.remove("is-armed");
    disarmAll();
    if (hasAll) {
      allBtn.setAttribute("data-tip", "Tutti — from the score: every instrument at once. Runs this command in its all form: every character, equipment or stage in the catalog, or items up to the current amount. Press twice to confirm.");
      allBtn.setAttribute("aria-label", "Tutti: run this command for every entry (press twice)");
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
      catalog(comboField.catalog).then(function (data) {
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

  function buildCommand() {
    var section = SECTIONS[current];

    for (var i = 0; i < section.fields.length; i += 1) {
      var field = section.fields[i];
      if (!field.required) continue;
      var pick = picks[field.key] && picks[field.key].value();
      if (field.type === "combo" || field.type === "grid") {
        if (!pick) return null;
        values[field.key] = pick;
      } else if (values[field.key] === undefined || values[field.key] === "") {
        return null;
      }
    }

    var args = section.build(values);
    if (args.some(function (a) { return a === null || a === undefined || a === ""; })) return null;
    return { name: section.command, args: args.map(String) };
  }

  function updatePreview() {
    var cmd = buildCommand();
    var preview = $("#preview");
    var text = $("#previewText");
    var run = $("#runBtn");

    if (!cmd) {
      text.textContent = "choose a target";
      preview.dataset.ready = "false";
      run.disabled = true;
      $("#runHint").textContent = "";
      return;
    }

    text.textContent = "/" + cmd.name + " " + cmd.args.join(" ");
    preview.dataset.ready = "true";
    run.disabled = false;
    $("#runHint").textContent = window.SelenaAPI.account ? "" : "sign in to perform";
  }

  /* ---------------------------------------------------------------- perform */


  /* ---------------------------------------------------------------- grant all */

  /* Every catalog command also accepts "all". It is a bulk write, so the button
   * arms on the first press and only fires on the second one inside five
   * seconds - no dialog, no silent mass grant. */
  var allArmed = false;
  var allTimer = null;

  function disarmAll() {
    allArmed = false;
    clearTimeout(allTimer);
    var button = $("#allBtn");
    if (button) {
      button.classList.remove("is-armed");
      button.textContent = "Tutti · all";
    }
  }

  async function performAll() {
    var section = SECTIONS[current];
    if (!section || typeof section.allArgs !== "function") return;

    var button = $("#allBtn");

    if (!allArmed) {
      allArmed = true;
      button.classList.add("is-armed");
      button.textContent = "Tutti · press again";
      allTimer = setTimeout(disarmAll, 5000);
      return;
    }

    disarmAll();

    if (!window.SelenaAPI.account) {
      await signIn();
      if (!window.SelenaAPI.account) return;
    }

    var cmd = { name: section.command, args: section.allArgs(values).map(String) };
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
      if (err && err.data) detail += "\n" + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      refreshStatus();
    } finally {
      $("#meter").dataset.state = "idle";
      button.disabled = false;
    }
  }

  async function perform(event) {
    if (event) event.preventDefault();

    var cmd = buildCommand();
    if (!cmd) return;

    if (!window.SelenaAPI.account) {
      await signIn();
      if (!window.SelenaAPI.account) return;
    }

    var run = $("#runBtn");
    run.disabled = true;
    run.textContent = "Performing…";
    $("#meter").dataset.state = "running";

    try {
      var response = await window.SelenaAPI.command(cmd.name, cmd.args);
      performed += 1;
      renderAccount();
      refreshStatus();
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, true, JSON.stringify(response, null, 2));
      $("#consoleMeta").textContent = opusLabel(performed);
      celebrate(run);
      window.SelenaAudio.chord();
    } catch (err) {
      performed += 1;
      var detail = (err && (err.message || String(err))) || "Request failed";
      if (err && err.data) detail += "\n" + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, detail);
      $("#consoleMeta").textContent = opusLabel(performed);
      refreshStatus();
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

  $("#accountBtn").addEventListener("click", function () {
    if (window.SelenaAPI.account) {
      window.SelenaAPI.logout();
      renderAccount();
    } else {
      signIn();
    }
  });

  $("#allBtn").addEventListener("click", performAll);
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
})();