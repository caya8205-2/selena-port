/* Selena-port GM console.
 *
 * Every action is one AscNet chat command (AscNet.GameServer/Commands), executed
 * through the SDK server with the signed-in account's token. The panel never
 * touches the database; the performance log shows exactly what the server said.
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
      fields: [{ key: "owner", type: "combo", catalog: "characters", label: "Owner", placeholder: "Search owned character name or ID", required: true, hint: "unlocks every coating of that character" }],
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
  var current = null;
  var values = {};
  var performed = 0;

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
  }

  async function signIn() {
    try {
      await window.SelenaAPI.promptLogin();
    } catch (err) {
      /* cancelled: nothing to do */
    }
    renderAccount();
    updatePreview();
  }

  /* ---------------------------------------------------------------- catalogs */

  async function catalog(kind) {
    if (catalogCache[kind]) return catalogCache[kind];
    var entries = await window.SelenaAPI.catalog(kind);
    catalogCache[kind] = entries;
    return entries;
  }

  /* ---------------------------------------------------------------- picker */

  function makeCombo(field) {
    var wrap = document.createElement("div");
    wrap.className = "combo";

    var input = document.createElement("input");
    input.className = "combo__input";
    input.type = "text";
    input.placeholder = field.placeholder || "";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");

    var list = document.createElement("ul");
    list.className = "combo__list";
    list.hidden = true;
    list.setAttribute("role", "listbox");

    wrap.appendChild(input);
    wrap.appendChild(list);

    var entries = [];
    var filtered = [];
    var active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    function renderList() {
      list.textContent = "";
      if (!filtered.length) {
        var empty = document.createElement("li");
        empty.className = "combo__empty";
        empty.textContent = entries.length ? "No entry matches that name or ID." : "Catalog is unavailable.";
        list.appendChild(empty);
      } else {
        filtered.slice(0, 200).forEach(function (entry, index) {
          var li = document.createElement("li");
          li.className = "combo__option";
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", index === active ? "true" : "false");

          var name = document.createElement("span");
          name.textContent = entry.name;
          var id = document.createElement("span");
          id.className = "combo__id";
          id.textContent = String(entry.id);

          li.appendChild(name);
          li.appendChild(id);
          li.addEventListener("mousedown", function (event) {
            event.preventDefault();
            choose(entry);
          });
          list.appendChild(li);
        });
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function choose(entry) {
      values[field.key] = entry;
      input.value = entry.name + " · " + entry.id;
      close();
      updatePreview();
    }

    function filter() {
      var q = input.value.trim().toLowerCase();
      filtered = q
        ? entries.filter(function (e) {
            return e.name.toLowerCase().indexOf(q) >= 0 || String(e.id).indexOf(q) === 0;
          })
        : entries;
      active = filtered.length ? 0 : -1;
    }

    input.addEventListener("focus", function () {
      input.select();
      filter();
      renderList();
    });

    input.addEventListener("input", function () {
      values[field.key] = null;
      updatePreview();
      filter();
      renderList();
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (list.hidden) return;
        event.preventDefault();
        var limit = Math.min(filtered.length, 200) - 1;
        active += event.key === "ArrowDown" ? 1 : -1;
        if (active < 0) active = 0;
        if (active > limit) active = limit;
        renderList();
        var el = list.children[active];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        if (!list.hidden && filtered[active]) {
          event.preventDefault();
          choose(filtered[active]);
        }
      } else if (event.key === "Escape") {
        close();
      }
    });

    input.addEventListener("blur", function () { setTimeout(close, 120); });

    catalog(field.catalog).then(function (data) {
      entries = data;
      filtered = data;
    }).catch(function () {
      entries = [];
      filtered = [];
    });

    return wrap;
  }

  /* ---------------------------------------------------------------- sections */

  function renderSection(key, keepValues) {
    var section = SECTIONS[key];
    current = key;
    if (!keepValues) values = {};

    document.querySelectorAll(".rail__item").forEach(function (el) {
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
        wrap.appendChild(makeCombo(field));
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
        wrap.appendChild(input);
      }

      host.appendChild(wrap);
    });

    if (section.note) {
      var note = document.createElement("p");
      note.className = "field__hint";
      note.style.margin = "0";
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
    var missing = section.fields.some(function (field) {
      if (!field.required) return false;
      var v = values[field.key];
      return v === null || v === undefined || v === "" || (field.type === "combo" && !v.id);
    });
    if (missing) return null;

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

  /* ---------------------------------------------------------------- performance log */

  function stamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  function pushEntry(cmd, ok, body) {
    if (performed === 0) $("#consoleList").textContent = "";
    performed += 1;

    var entry = document.createElement("div");
    entry.className = "entry " + (ok ? "entry--ok" : "entry--err");

    var head = document.createElement("div");
    head.className = "entry__head";

    var t = document.createElement("span");
    t.className = "entry__time";
    t.textContent = stamp();

    var c = document.createElement("span");
    c.className = "entry__cmd";
    c.textContent = "/" + cmd.name + " " + cmd.args.join(" ");

    var tag = document.createElement("span");
    tag.className = "entry__tag";
    tag.textContent = ok ? "ok" : "error";

    head.appendChild(t);
    head.appendChild(c);
    head.appendChild(tag);

    var bodyEl = document.createElement("pre");
    bodyEl.className = "entry__body";
    bodyEl.textContent = body;

    entry.appendChild(head);
    entry.appendChild(bodyEl);

    var list = $("#consoleList");
    list.insertBefore(entry, list.firstChild);
    $("#consoleMeta").textContent = performed + (performed === 1 ? " command" : " commands");
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

    try {
      var response = await window.SelenaAPI.command(cmd.name, cmd.args);
      renderAccount();
      pushEntry(cmd, true, JSON.stringify(response, null, 2));
    } catch (err) {
      var detail = err && (err.message || String(err));
      if (err && err.data) detail += "\n" + JSON.stringify(err.data, null, 2);
      pushEntry(cmd, false, detail);
    } finally {
      run.textContent = "Perform";
      run.disabled = false;
      updatePreview();
    }
  }

  /* ---------------------------------------------------------------- wiring */

  document.querySelectorAll(".rail__item").forEach(function (el) {
    el.addEventListener("click", function () { renderSection(el.dataset.section, false); });
  });

  $("#accountBtn").addEventListener("click", function () {
    if (window.SelenaAPI.account) {
      window.SelenaAPI.logout();
      renderAccount();
      updatePreview();
    } else {
      signIn();
    }
  });

  $("#actionForm").addEventListener("submit", perform);

  $("#clearBtn").addEventListener("click", function () {
    performed = 0;
    $("#consoleMeta").textContent = "0 commands";

    var list = $("#consoleList");
    list.textContent = "";

    var empty = document.createElement("div");
    empty.className = "console__empty";
    var strong = document.createElement("strong");
    strong.textContent = "Nothing performed yet";
    empty.appendChild(strong);
    empty.appendChild(document.createTextNode("Choose a target, run the action, and the server response appears here."));
    list.appendChild(empty);
  });

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") perform(event);
  });

  renderAccount();
  renderSection("items", false);
})();