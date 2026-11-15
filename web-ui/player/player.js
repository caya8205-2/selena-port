/* Selena-port player page.
 *
 * Grants to your own account through the same AscNet chat commands the GM page
 * and the in-game `/help` use. The account comes from a local username and
 * password; there is no other player to target, by design of the command layer.
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
      build: function (v) { return ["add", v.item.id, v.qty]; }
    },
    characters: {
      title: "Characters",
      command: "character",
      fields: [{ key: "character", type: "grid", catalog: "characters", label: "Character", placeholder: "Search construct, trade name or ID", required: true }],
      build: function (v) { return ["add", v.character.id]; }
    },
    equipment: {
      title: "Equipment",
      command: "equip",
      fields: [{ key: "equip", type: "grid", catalog: "equips", label: "Equipment", placeholder: "Search weapon or memory, or filter by star", required: true }],
      build: function (v) { return ["add", v.equip.id]; }
    },
    coatings: {
      title: "Coatings",
      command: "coating",
      fields: [{ key: "owner", type: "grid", catalog: "characters", label: "Character", placeholder: "Search construct, trade name or ID", required: true, hint: "unlocks every coating of that character" }],
      build: function (v) { return ["unlock", v.owner.id]; }
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
      build: function (v) { return [v.stage.id]; }
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
    equipment: "Grant weapons and memories by star. Equipped slots stay untouched.",
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


  /* ---------------------------------------------------------------- account */

  function renderAccount() {
    var acc = window.SelenaAPI.account;
    var status = $("#connStatus");
    var text = $("#connText");
    var label = $("#accountLabel");
    var btn = $("#accountBtn");

    $("#accountForm").hidden = !!acc;
    $("#accountPanel").hidden = !acc;

    if (acc) {
      status.classList.add("is-online");
      status.classList.remove("is-offline");
      text.textContent = "Signed in";
      label.textContent = acc.username + " · UID " + acc.uid;
      $("#accountName").textContent = acc.username;
      $("#accountUid").textContent = "UID " + acc.uid + " · commands apply to this account";
      btn.textContent = "Sign out";
    } else {
      status.classList.remove("is-online");
      status.classList.add("is-offline");
      text.textContent = "Signed out";
      label.textContent = "No account";
      btn.textContent = "Sign in";
      $("#accountError").textContent = "";
    }

    updatePreview();
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
    }
  }

  async function authenticate(register) {
    var user = $("#username").value.trim();
    var pass = $("#password").value;
    var errorBox = $("#accountError");

    if (!user || !pass) {
      errorBox.textContent = "Enter both a username and a password.";
      return;
    }

    errorBox.textContent = "Contacting the server…";
    try {
      await window.SelenaAPI.login(user, pass, register);
      $("#password").value = "";
      errorBox.textContent = "";
      renderAccount();
      refreshStatus();
    } catch (err) {
      var message = (err && err.message) || "Sign in failed";
      if (register && /already/i.test(message)) message = "That username is already registered - sign in instead.";
      errorBox.textContent = message;
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
      refreshStatus();
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
        var payload = await window.SelenaAPI.command("cleanup", args);
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
        var payload = await window.SelenaAPI.command("cleanup", args);
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

  function renderSection(key) {
    current = key;
    values = {};
    picks = {};

    var section = SECTIONS[key];

    document.querySelectorAll(".rail__item[data-section]").forEach(function (el) {
      if (el.dataset.section === key) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    $("#sectionTitle").textContent = section.title;

    var host = $("#formFields");
    host.textContent = "";

    /* Custom sections own their own actions, so the generic score preview and
     * Perform button step aside instead of showing a command that cannot run. */
    var isCustom = Boolean(section.custom);
    $("#preview").hidden = isCustom;
    $("#runBtn").hidden = isCustom;
    var previewLabel = $("#previewLabel");
    if (previewLabel) previewLabel.hidden = isCustom;

    if (section.custom === "cleanup") {
      renderCleanup(host);
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

  async function perform(event) {
    if (event) event.preventDefault();

    var cmd = buildCommand();
    if (!cmd) return;

    if (!window.SelenaAPI.account) {
      $("#accountError").textContent = "Sign in first, then perform the action.";
      $("#username").focus();
      return;
    }

    var run = $("#runBtn");
    run.disabled = true;
    run.textContent = "Performing…";
    $("#meter").dataset.state = "running";

    try {
      var response = await window.SelenaAPI.command(cmd.name, cmd.args);
      performed += 1;
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

  document.querySelectorAll(".rail__item[data-section]").forEach(function (el) {
    el.addEventListener("click", function () { renderSection(el.dataset.section); });
  });

  $("#accountForm").addEventListener("submit", function (event) {
    event.preventDefault();
    authenticate(false);
  });

  $("#registerBtn").addEventListener("click", function () { authenticate(true); });

  $("#signOutBtn").addEventListener("click", function () {
    window.SelenaAPI.logout();
    renderAccount();
  });

  $("#accountBtn").addEventListener("click", function () {
    if (window.SelenaAPI.account) {
      window.SelenaAPI.logout();
      renderAccount();
    } else {
      $("#username").focus();
    }
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

  Array.prototype.forEach.call(document.querySelectorAll(".rail__item[data-state='unavailable']"), function (el) {
    el.setAttribute("data-tip", "No command backs this yet: it needs a server-side handler, specified in docs/stage-b.md.");
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