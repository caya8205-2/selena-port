/* Selena-port panel API adapter.
 *
 * The panel talks to the local SDK server through the same endpoints the game
 * and the in-game chat commands use:
 *   POST /api/AscNet/login            -> { account: { Uid, Username, Token } }
 *   GET  /api/AscNet/commands         -> { data: [{ name, help }] }
 *   POST /api/AscNet/command/{name}   -> { msg }  (Authorization: <token>)
 *
 * Catalog data (items, characters, equips, stages) is served by the panel host
 * itself from the server's TSV tables: GET /api/panel/catalog/{kind}.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "selena.token";
  var ACCOUNT_KEY = "selena.account";
  var CSRF_HEADER = "Authorization";

  function readJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }

  function writeJson(key, value) {
    try {
      if (value === null || value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode: keep it in memory only */ }
  }

  var memoryAccount = null;

  function account() {
    return readJson(ACCOUNT_KEY) || memoryAccount;
  }

  function setAccount(next) {
    memoryAccount = next;
    writeJson(ACCOUNT_KEY, next);
  }

  function clearAccount() {
    memoryAccount = null;
    writeJson(ACCOUNT_KEY, null);
    writeJson(TOKEN_KEY, null);
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    var acc = account();
    if (acc && acc.token && opts.auth !== false) {
      headers[CSRF_HEADER] = acc.token;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    var res = await fetch(path, {
      method: opts.method || (opts.body === undefined ? "GET" : "POST"),
      headers: headers,
      cache: "no-store",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });

    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { msg: text }; }

    if (!res.ok) {
      var err = new Error((data && (data.msg || data.error)) || ("HTTP " + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function login(username, password, register) {
    var data = await request(register ? "/api/AscNet/register" : "/api/AscNet/login", {
      method: "POST",
      auth: false,
      body: { username: username, password: password }
    });

    if (!data || data.code !== 0 || !data.account) {
      throw new Error((data && data.msg) || "Login failed");
    }

    var acc = {
      uid: data.account.Uid,
      username: data.account.Username,
      token: data.account.Token
    };
    setAccount(acc);
    return acc;
  }

  function logout() {
    clearAccount();
  }

  async function catalog(kind) {
    var data = await request("/api/panel/catalog/" + encodeURIComponent(kind), { auth: false });
    return (data && data.entries) || [];
  }

  async function commands() {
    var data = await request("/api/AscNet/commands", { auth: false });
    return (data && data.data) || [];
  }

  /* Coatings of one character come from a dedicated read-only route: the list
   * depends on the character, so it cannot be a flat catalog. */
  async function coatings(characterId) {
    var data = await request("/api/panel/coatings/" + encodeURIComponent(characterId), { auth: false });
    return (data && data.entries) || [];
  }

  async function command(name, args) {
    if (!account()) throw new Error("Log in first");
    return request("/api/AscNet/command/" + encodeURIComponent(name), {
      method: "POST",
      body: { args: (args || []).map(String) }
    });
  }

  /* Small credential modal, so the GM page (which has no login form) can ask
   * for an account without any HTML changes. */
  function promptLogin() {
    return new Promise(function (resolve, reject) {
      var existing = document.getElementById("selenaLoginOverlay");
      if (existing) existing.remove();

      var overlay = document.createElement("div");
      overlay.id = "selenaLoginOverlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(4,6,10,.72);backdrop-filter:blur(3px)";

      var box = document.createElement("form");
      box.style.cssText = "min-width:280px;max-width:92vw;padding:18px 20px;border:1px solid rgba(216,62,62,.35);border-radius:10px;background:#0d0f14;color:#e7e9ee;font:13px/1.5 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)";
      box.innerHTML =
        '<div style="font-weight:600;letter-spacing:.5px;margin-bottom:2px">Local account</div>' +
        '<p style="margin:0 0 12px;color:#9aa1ae">Use the account created inside the game. Never your Kuro account.</p>' +
        '<label style="display:block;margin-bottom:10px">Username' +
        '<input name="u" autocomplete="username" required style="display:block;width:100%;margin-top:4px;padding:7px 9px;background:#12151c;border:1px solid #2a2f3a;border-radius:6px;color:#e7e9ee"></label>' +
        '<label style="display:block;margin-bottom:14px">Password' +
        '<input name="p" type="password" autocomplete="current-password" required style="display:block;width:100%;margin-top:4px;padding:7px 9px;background:#12151c;border:1px solid #2a2f3a;border-radius:6px;color:#e7e9ee"></label>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button type="button" data-act="cancel" style="padding:7px 14px;border:1px solid #2a2f3a;background:transparent;color:#9aa1ae;border-radius:6px;cursor:pointer">Cancel</button>' +
        '<button type="submit" style="padding:7px 14px;border:1px solid #d83e3e;background:#d83e3e;color:#fff;border-radius:6px;cursor:pointer">Log in</button>' +
        '</div>' +
        '<p data-err style="margin:10px 0 0;color:#e2776f;min-height:1em"></p>';

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      var userInput = box.querySelector('input[name="u"]');
      userInput.focus();

      function close() { overlay.remove(); }
      box.querySelector('[data-act="cancel"]').addEventListener("click", function () {
        close();
        reject(new Error("Login cancelled"));
      });
      box.addEventListener("submit", async function (event) {
        event.preventDefault();
        var errBox = box.querySelector("[data-err]");
        errBox.textContent = "";
        try {
          var acc = await login(box.querySelector('input[name="u"]').value.trim(), box.querySelector('input[name="p"]').value, false);
          close();
          resolve(acc);
        } catch (err) {
          errBox.textContent = err.message || "Login failed";
        }
      });
    });
  }

  async function ensureAccount() {
    if (account()) return account();
    return promptLogin();
  }


  /* Online status without a status endpoint: `save` is idempotent for the
   * owner, and the server answers 400 "Player is offline!" when the account has
   * no live session. Anything else (200) means the player is in game. */
  async function status() {
    if (!account()) return { state: "signed-out" };
    try {
      await command("save", []);
      return { state: "in-game" };
    } catch (err) {
      /* A 401 here does not mean the panel session died: the account token is
       * valid, but the server only authorises commands for a player record that
       * the game creates on login. Report that state instead of logging out. */
      if (err && err.status === 401 && account()) return { state: "account-only", detail: err.message };
      if (err && err.status === 400) return { state: "not-in-game", detail: err.message };
      return { state: "unknown", detail: (err && err.message) || "probe failed" };
    }
  }

  window.SelenaAPI = {
    get account() { return account(); },
    login: login,
    logout: logout,
    ensureAccount: ensureAccount,
    promptLogin: promptLogin,
    catalog: catalog,
    commands: commands,
    command: command,
    coatings: coatings,
    status: status
  };
})();