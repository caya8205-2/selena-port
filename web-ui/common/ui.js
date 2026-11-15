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
          // The second fact a table gives (a trade name, a star rating) is what tells two
          // entries apart; the id alone is not.
          if (entry.meta) {
            var meta = document.createElement("span");
            meta.className = "combo__meta";
            meta.textContent = entry.meta;
            li.appendChild(meta);
          }
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

    /* The stepper is used with ad-hoc field descriptors too, so the label is
     * optional rather than a crash waiting to happen. */
    var label = String(field.label || "the value").toLowerCase();

    wrap.appendChild(input);
    wrap.appendChild(button("\u2212", "Decrease " + label, -1));
    wrap.appendChild(button("+", "Increase " + label, 1));
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


  /* ---------------------------------------------------------------- tooltips */

  /* One tooltip element for the whole page, driven by [data-tip]. Hover and
   * keyboard focus both open it; Escape closes it. Position flips above/below
   * depending on the room available, and it is clamped to the viewport. */
  var tipEl = null;

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    tipEl.id = "selenaTip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function showTip(target) {
    var text = target.getAttribute("data-tip");
    if (!text) return;

    var tip = ensureTip();
    tip.textContent = text;
    tip.hidden = false;

    var rect = target.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var gap = 8;

    var top = rect.top - box.height - gap;
    var place = "top";
    if (top < 8) {
      top = rect.bottom + gap;
      place = "bottom";
    }

    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));

    tip.style.top = Math.round(top) + "px";
    tip.style.left = Math.round(left) + "px";
    tip.dataset.place = place;
    target.setAttribute("aria-describedby", "selenaTip");
  }

  function hideTip(target) {
    if (tipEl) tipEl.hidden = true;
    if (target) target.removeAttribute("aria-describedby");
  }

  function initTooltips() {
    document.addEventListener("mouseover", function (event) {
      var target = event.target.closest("[data-tip]");
      if (target) showTip(target);
    });

    document.addEventListener("mouseout", function (event) {
      var target = event.target.closest("[data-tip]");
      if (target && !target.contains(event.relatedTarget)) hideTip(target);
    });

    document.addEventListener("focusin", function (event) {
      var target = event.target.closest("[data-tip]");
      if (target) showTip(target);
    });

    document.addEventListener("focusout", function (event) {
      var target = event.target.closest("[data-tip]");
      if (target) hideTip(target);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hideTip(null);
    });

    window.addEventListener("scroll", function () { hideTip(null); }, true);
  }


  /* ---------------------------------------------------------------- card grid */

  /* A gallery for sections whose entries are worth seeing at once: a search box
   * over a grid of cards. Each card carries the entry's real second line (trade
   * name, star rating) or nothing at all, and the grid caps what it draws so a
   * 3000 row table does not become a 3000 node page. */
  function grid(field, load, onChange) {
    var wrap = document.createElement("div");
    wrap.className = "grid";

    var search = document.createElement("input");
    search.className = "grid__search";
    search.type = "text";
    search.autocomplete = "off";
    search.placeholder = field.placeholder || "Search";
    search.setAttribute("aria-label", field.label || "Search");

    var cards = document.createElement("div");
    cards.className = "grid__cards";
    if (field.columns === 3) cards.classList.add("grid__cards--three");
    cards.setAttribute("role", "listbox");
    cards.setAttribute("aria-label", field.label || "Entries");

    var searchWrap = document.createElement("div");
    searchWrap.className = "grid__searchwrap";
    searchWrap.appendChild(search);

    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "grid__clear";
    clear.setAttribute("aria-label", "Clear the search");
    clear.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/></svg>';
    clear.hidden = true;
    clear.addEventListener("click", function () {
      search.value = "";
      clear.hidden = true;
      filter();
      search.focus();
    });
    searchWrap.appendChild(clear);

    var status = document.createElement("p");
    status.className = "grid__status";

    wrap.appendChild(searchWrap);
    wrap.appendChild(cards);
    wrap.appendChild(status);

    /* A short first page keeps the form usable, and the exact total is printed next to a
     * button that draws the rest. The old silent cap read as a missing catalog; this one
     * says how many exist, so nothing is hidden without the player knowing. */
    var PAGE = 48;
    var page = PAGE;
    var entries = [];
    var selected = null;
    var active = -1;
    var shown = [];
    var hits = 0;

    function matches(entry, query) {
      if (!query) return true;
      return (entry.name + " " + (entry.meta || "") + " " + entry.id).toLowerCase().indexOf(query) >= 0;
    }

    function paint() {
      cards.textContent = "";
      shown.forEach(function (entry, index) {
        var card = document.createElement("button");
        card.type = "button";
        card.className = "card";
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", selected && selected.id === entry.id ? "true" : "false");
        if (index === active) card.classList.add("is-active");

        var name = document.createElement("span");
        name.className = "card__name";
        name.textContent = entry.name;

        var meta = document.createElement("span");
        meta.className = "card__meta";
        meta.textContent = entry.meta && entry.meta.length
          ? entry.meta
          : String(entry.id);

        card.appendChild(name);
        card.appendChild(meta);

        card.addEventListener("click", function () {
          selected = entry;
          active = index;
          paint();
          onChange();
        });

        cards.appendChild(card);
      });

      if (shown.length === 0) {
        var empty = document.createElement("p");
        empty.className = "grid__empty";
        empty.textContent = "Nothing matches that search.";
        cards.appendChild(empty);
      }

      status.textContent = "";
      if (hits > shown.length) {
        status.appendChild(document.createTextNode(shown.length + " of " + hits + " entries "));
        var more = document.createElement("button");
        more.type = "button";
        more.className = "grid__more";
        more.textContent = "Show all " + hits;
        more.addEventListener("click", function () { page = hits; filter(); });
        status.appendChild(more);
      } else {
        status.textContent = hits + (hits === 1 ? " entry" : " entries");
      }

      window.SelenaUI.hideTip(null);
    }

    function filter() {
      var query = search.value.trim().toLowerCase();
      var found = entries.filter(function (entry) { return matches(entry, query); });
      hits = found.length;
      shown = found.slice(0, page);
      if (selected && found.indexOf(selected) < 0) selected = null;
      paint();
    }

    search.addEventListener("input", function () {
      page = PAGE;
      clear.hidden = search.value.length === 0;
      filter();
    });

    search.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && search.value.length) {
        event.stopPropagation();
        search.value = "";
        clear.hidden = true;
        filter();
      }
    });

    search.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (shown.length === 0) return;
        active = event.key === "ArrowDown"
          ? Math.min(active + 1, shown.length - 1)
          : Math.max(active - 1, 0);
        paint();
        var node = cards.children[active];
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && active >= 0 && shown[active]) {
        event.preventDefault();
        selected = shown[active];
        paint();
        onChange();
      }
    });

    load().then(function (data) {
      entries = data || [];
      filter();
    }).catch(function () {
      entries = [];
      filter();
    });

    return {
      node: wrap,
      value: function () { return selected; }
    };
  }


  window.SelenaUI = { combo: combo, stepper: stepper, entry: entry, resetLog: resetLog, initTooltips: initTooltips, hideTip: hideTip, grid: grid };
})();

window.SelenaUI.initTooltips();
