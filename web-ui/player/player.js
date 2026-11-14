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
      fields: [{ key: "character", type: "combo", catalog: "characters", label: "Character", placeholder: "Search character name or ID", required: true }],
      build: function (v) { return ["add", v.character.id]; }
    },
    equipment: {
      title: "Equipment",
      command: "equip",
      fields: [{ key: "equip", type: "combo", catalog: "equips", label: "Equipment", placeholder: "Search equipment name or ID", required: true }],
      build: function (v) { return ["add", v.equip.id]; }
    },
    coatings: {
      title: "Coatings",
      command: "coating",
      fields: [{ key: "owner", type: "combo", catalog: "characters", label: "Character", placeholder: "Search owned character name or ID", required: true, hint: "unlocks every coating of that character" }],
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
    }
  };

  var catalogCache = {};
  var current = "items";
  var values = {};
  var picks = {};
  var performed = 0;

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
    } else if (result.state === "not-in-game") {
      status.classList.remove("is-online");
      status.classList.add("is-offline");
      text.textContent = "Not in game";
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
    var comboField = section.fields.filter(function (f) { return f.type === "combo"; })[0];
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
      if (field.type === "combo") {
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

    try {
      var response = await window.SelenaAPI.command(cmd.name, cmd.args);
      performed += 1;
      refreshStatus();
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, true, JSON.stringify(response, null, 2));
    } catch (err) {
      performed += 1;
      var detail = (err && (err.message || String(err))) || "Request failed";
      if (err && err.data) detail += "\n" + JSON.stringify(err.data, null, 2);
      window.SelenaUI.entry($("#consoleList"), $("#consoleMeta"), performed, cmd, false, detail);
      refreshStatus();
    } finally {
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
    $("#consoleMeta").textContent = "0 commands";
    window.SelenaUI.resetLog($("#consoleList"), "Nothing performed yet",
      "Choose a target, run the action, and the server response appears here.");
  });

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") perform(event);
  });

  renderAccount();
  renderSection("items");
  if (window.SelenaAPI.account) refreshStatus();
})();