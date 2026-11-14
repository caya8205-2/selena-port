# AscNet.WebPanel

Selena-port's browser panel: the GM console and the player self-service page.

It is a **backend-for-frontend**, not a second server. It serves the static panel
from `../web-ui` and forwards every `/api/*` call to the AscNet SDK server. That
keeps all state changes on the same code path the game and the in-game chat
commands already use, and it means the fork never has to patch upstream projects.

```
browser ──▶ :8081  AscNet.WebPanel ──▶ :8085  AscNet.SDKServer
             static /gm, /player        /api/AscNet/login
             proxy  /api/*              /api/AscNet/commands
                                        /api/AscNet/command/{name}
```

## Why a proxy instead of direct calls

- The SDK server stays bound to loopback and the panel is the only HTTP surface
  exposed to the browser.
- No CORS rules and no duplicate token handling in the panel JS.
- Nothing in the upstream projects has to change to ship a web UI.

## API used (all upstream, unchanged)

| Call | Purpose |
|---|---|
| `POST /api/AscNet/register` | create a local account |
| `POST /api/AscNet/login` | username + password, returns the player token |
| `GET /api/AscNet/commands` | command list with help text |
| `POST /api/AscNet/command/{name}` | execute a command; `Authorization: <token>`, body `{ "args": [...] }` |

Available commands today: `item`, `character`, `equip`, `coating`, `scene`,
`level`, `stage`, `blackcard`, `save`. Argument shapes are declared per command
class (`AscNet.GameServer/Commands/*.cs`), for example:

```
item add <id|all> [<amount>|max]
character add <id|all>
level <n|max>
```

## Run

```powershell
# SDK server first (whatever port you gave it)
dotnet run --project AscNet --urls http://127.0.0.1:8085

# then the panel
dotnet run --project AscNet.WebPanel
# http://127.0.0.1:8081/gm  ,  http://127.0.0.1:8081/player
```

Configuration (`appsettings.json`, overridable by environment):

| Key | Env var | Default | Meaning |
|---|---|---|---|
| `Panel:Url` | `SELENA_PANEL_URL` | `http://127.0.0.1:8081` | where the panel listens |
| `Panel:SdkUrl` | `SELENA_SDK_URL` | `http://127.0.0.1:8085` | AscNet SDK server base URL |
| `Panel:WebUi` | `SELENA_WEB_UI` | auto-detected `web-ui/` | static panel directory |

**Port note:** upstream defaults to SDK port `8080`, but on this machine `8080`
is already taken by `wslrelay.exe` (WSL port relay), which answers with an
unrelated 404. Use `8085` (or any free port) and keep the panel's `Panel:SdkUrl`
in sync with whatever the launcher or `run_steam.py` chose.

## Roadmap inside this project

1. **Base (done)**: static hosting, `/api/*` pass-through, panel served in English.
2. **Wire the UI**: replace the old `/api/AscNet/gm/*` + `/api/player/*` calls in
   `web-ui/gm/gm.js` and `web-ui/player/panel.js` with the command API above
   (login -> token -> command execution), including the command argument shapes.
3. **Extras beyond the command layer** (only where no command exists): inventory
   cleanup by rarity/category, dorm blueprint shortfall calculation, per-player
   online status. These need new server-side handlers and will be proposed to
   upstream separately rather than patched in silently.