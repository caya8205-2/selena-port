/* Shared UI pieces for the Selena-port panels.
 *
 * One implementation of the target picker, the number stepper and the log
 * entries, so the GM console and the player page cannot drift apart.
 */
(function () {
  "use strict";

  /**
   * Searchable picker over a catalog of { id, name } entries.
   * @param {object} field   { key, label, placeholder }
   * @param {function} load  returns a Promise of entries
   * @param {function} onChange  called after a selection or text edit
   */
  function combo(field, load, onChange) {
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
    var selected = null;
    var active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    /* Open downwards, or upwards when the viewport has no room below, so the
     * list is never clipped by the card or the window edge. */
    function place() {
      var rect = input.getBoundingClientRect();
      var rows = Math.min(filtered.length, 200);
      var wanted = Math.min(292, rows * 34 + 12);
      var below = window.innerHeight - rect.bottom - 12;
      if (below < wanted && rect.top > below) {
        list.style.top = "auto";
        list.style.bottom = "calc(100% + 4px)";
      } else {
        list.style.top = "calc(100% + 4px)";
        list.style.bottom = "auto";
      }
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
      place();
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function choose(entry) {
      selected = entry;
      input.value = entry.name + " · " + entry.id;
      close();
      onChange();
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
      selected = null;
      onChange();
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

    load().then(function (data) {
      entries = data;
      filtered = data;
    }).catch(function () {
      entries = [];
      filtered = [];
    });

    return {
      node: wrap,
      value: function () { return selected; }
    };
  }

  /**
   * Number field with console-styled stepper buttons; the native OS spinner is
   * hidden in CSS. Clamps to field min/max and keeps keyboard behaviour.
   */
  function stepper(input, field, onChange) {
    var wrap = document.createElement("div");
    wrap.className = "stepper";

    function step(delta) {
      var min = field.min !== undefined ? Number(field.min) : -Infinity;
      var max = field.max !== undefined ? Number(field.max) : Infinity;
      var current = input.value === "" ? 0 : Number(input.value);
      if (isNaN(current)) current = min === -Infinity ? 0 : min;
      var next = current + delta;
      if (next < min) next = min;
      if (next > max) next = max;
      input.value = String(next);
      onChange();
    }

    function button(label, aria, delta) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "stepper__btn";
      el.textContent = label;
      el.setAttribute("aria-label", aria);
      el.addEventListener("click", function () {
        step(delta);
        input.focus();
      });
      return el;
    }

    wrap.appendChild(input);
    wrap.appendChild(button("\u2212", "Decrease " + field.label.toLowerCase(), -1));
    wrap.appendChild(button("+", "Increase " + field.label.toLowerCase(), 1));
    return wrap;
  }

  /** Append a log entry (newest first) and update the counter. */
  function entry(container, meta, counter, cmd, ok, body) {
    if (counter === 1) container.textContent = "";

    var row = document.createElement("div");
    row.className = "entry " + (ok ? "entry--ok" : "entry--err");

    var head = document.createElement("div");
    head.className = "entry__head";

    var time = document.createElement("span");
    time.className = "entry__time";
    time.textContent = new Date().toTimeString().slice(0, 8);

    var text = document.createElement("span");
    text.className = "entry__cmd";
    text.textContent = "/" + cmd.name + " " + cmd.args.join(" ");

    var tag = document.createElement("span");
    tag.className = "entry__tag";
    tag.textContent = ok ? "ok" : "error";

    head.appendChild(time);
    head.appendChild(text);
    head.appendChild(tag);

    var payload = document.createElement("pre");
    payload.className = "entry__body";
    payload.textContent = body;

    row.appendChild(head);
    row.appendChild(payload);
    container.insertBefore(row, container.firstChild);

    if (meta) meta.textContent = counter + (counter === 1 ? " command" : " commands");
    return row;
  }

  /** Restore the neutral empty state of a log container. */
  function resetLog(container, title, hint) {
    container.textContent = "";
    var empty = document.createElement("div");
    empty.className = "empty";
    var strong = document.createElement("strong");
    strong.textContent = title;
    empty.appendChild(strong);
    empty.appendChild(document.createTextNode(hint));
    container.appendChild(empty);
  }

  window.SelenaUI = { combo: combo, stepper: stepper, entry: entry, resetLog: resetLog };
})();