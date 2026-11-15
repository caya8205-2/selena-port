# Selena-port working state

Notes for whoever picks this up next, written by the agent that built it. `plans/` next to
this file holds task plans; this file holds what the code and the machine actually do,
so a fresh session does not have to rediscover it.

Last updated: after commit `2e17384` (weapons/memories split, acting-account picker, rail scroll).

---

## 1. What this is

Fork of the AscNet private server for Punishing: Gray Raven, running natively on Windows,
plus a redesigned web panel (English, Selena theme) and an Electron control centre that
supervises MongoDB, the server and the game client in one window.

- Repo: `C:\Users\Caya\Desktop\Project\selena-port`, branch `selena-panel`, local commits only.
  Pushing needs the owner's explicit permission.
- Upstream: `reiserFSs/InfiniteLoop` (remote `upstream`). Server code is upstream's;
  our additions are `AscNet.SDKServer/Controllers/AdminController.cs`,
  `AscNet.GameServer/Commands/AccountCommand.cs`, `AscNet.WebPanel/`, `desktop/`, `web-ui/`.
- Do not touch the pristine client at `E:\Punishing Gray Raven`. The test copy lives at
  `D:\gemink\Punishing Gray Raven` (90,277 files, 68.7 GB) because the launcher patches files.

## 2. How to run it

Server stack (mongod + server + panel), from `tools/`:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\SelenaPort-ControlCenter.ps1 -Action start|stop|status

Desktop app (Electron shell that serves the panels and supervises everything):

    cd desktop && ./node_modules/electron/dist/electron.exe .

The shell picks a random port and writes it to `%APPDATA%\Selena-port\logs\ui-port.txt`.
Pages: `/ui/index.html` (Console/GM/Player/Accounts/Config/Update), `/gm/index.html`,
`/player/index.html`.

Builds (dotnet is at `C:\Users\Caya\AppData\Local\Microsoft\dotnet`, already on PATH):

    dotnet build AscNet/AscNet.csproj            # server (stop the stack first, file lock)
    dotnet build AscNet.WebPanel/AscNet.WebPanel.csproj

Ports: MongoDB 27017, server/SDK 8085, .NET panel 8081, game 2335, HTTP 80/HTTPS 443.
8080 belongs to another app on this machine (analytics dashboard), never bind it.

## 3. Where the truth lives

| Thing | Location |
| --- | --- |
| Game tables (TSV) | `Resources/table/share/...`, copied to `AscNet/bin/Debug/net8.0/table/` at build |
| MongoDB binary | `D:\mongo\mongodb-win32-x86_64-windows-7.0.48\bin\mongod.exe` |
| Mongo data (accounts!) | `D:\mongo\data`, database `asc_net` |
| Admin token | `<server build dir>\admin-token.txt`, generated at startup, sent as `X-Admin-Token` |
| Backups | `%APPDATA%\Selena-port\backups\<stamp>_<reason>\{data,Configs}`, newest 5 kept |
| Panel design system | `web-ui/common/theme.css` (+ `ui.js`, `api.js`, `sound.js`) |
| Panel markup/JS | `web-ui/gm/*`, `web-ui/player/*` |
| Desktop shell | `desktop/main.js`, `preload.js`, `verify.js`, `backup.js`, `ui/*` |

## 4. Data facts that were hard to learn

- Equip.tsv columns: `Id, Type, Site, Quality, Star, WeaponSkillId, Priority, DefaultLock,
  CharacterId, SuitId, CharacterType, Name, LogName, Description, NeedFirstShow`.
- **`Site` is the discriminator**: 0 = weapon (251 rows), 1..6 = memory grid slot
  (about 690 memory rows). `WeaponSkillId != 0` also marks weapons and is what the split used.
- A memory set is six rows sharing `SuitId`, one per slot. Burana = SuitId 1649, ids
  3016049..3066049, all named "Burana". Slot layouts differ per construct, which is why the
  panel grants the whole set instead of guessing four pieces.
- Slot numbering is 1-3 top row, 4-6 bottom row, three per row in the game UI.
- Character.tsv `TradeName` gives the second card line; Equip.tsv `Star` gives the star meta.
- The `equip` command accepts `add <id>` and `add all` only, with no type filter: Tutti in the
  Weapons or Memories section grants every equip of both kinds. Say so in the tooltip.
- Catalog endpoints: Node `desktop/main.js` (`/api/panel/catalog/<kind>`, `/api/panel/accounts`,
  now `/api/panel/memory-sets`) and, for parity, `AscNet.WebPanel/Catalog.cs`.

## 5. What is done and verified

- Server boots native on Windows with MongoDB; client patched by the launcher and redirected
  to our server through `ASCNET_PATCH_ORIGIN=http://127.0.0.1:8085`.
- Panel redesign, design system, sound cues, Tutti bulk with two-press arming, card grid
  catalogs, tooltips, themed scrollbars.
- Phase A verify (`desktop/verify.js`): six checks, all true on this machine.
- Phase B backup (`desktop/backup.js`): stops the stack, snapshots `D:\mongo\data` + Configs,
  restarts; verified with 47 database files including WiredTiger.
- Phase C accounts: `account list|show|delete|reset` command, plus `/api/admin/accounts`
  (list, create, set player name/level, delete, reset) that work **without a game session**.
  Verified by curl: create uid 3, list 3, delete, list 2.
- Weapons/Memories split in both panel catalogs; GM rail is exactly eight entries; the
  acting-account picker reads the admin list on both panels; rail nav scrolls at 1024x720
  (client 598 vs scroll 743) while the status foot stays pinned.

## 6. Work in progress (uncommitted when this note was written)

Feature: memory slot numbers, three-column wardrobe, grant-whole-set button.

Already edited on disk, additive and safe:

1. `desktop/main.js`
   - catalog source `memories` now filters on `Site` and passes `slot: 'Site'`;
     `parseTsv` takes a `slotColumn` and appends `· Slot N` to the card meta.
   - new `memorySets()` groups Equip.tsv by `SuitId`, keeps suits with six slots,
     returns `{id, name, meta: "6★ · 6 memories", slots:[{site,id}]}` sorted by name.
   - new route `GET /api/panel/memory-sets` (404 when the table is missing).
2. `web-ui/common/ui.js` - `grid()` adds `grid__cards--three` when `field.columns === 3`.
3. `web-ui/common/theme.css` - `.grid__cards--three { repeat(3, minmax(0,1fr)) }` plus comment.

Still to do for this feature:

- `web-ui/common/ui.js`: add a `memorySetGrant(onGrant)` widget (select of sets + "Grant set"
  button + status line) that reads `/api/panel/memory-sets` and calls `onGrant(slots)`.
- `web-ui/gm/console.js` and `web-ui/player/player.js`: on the `memories` section set
  `columns: 3` on the grid field, add `setGrant: true`, mount the widget after the fields
  loop, and run one `SelenaAPI.command("equip", ["add", id])` per slot in order, logging the
  six results as one line. Disable the button while it runs.
- `AscNet.WebPanel/Catalog.cs`: mirror the `· Slot N` meta so the .NET panel does not disagree
  (the set endpoint can stay Node-only; the widget must hide itself when it 404s).
- Verify: `/api/panel/catalog/memories` shows slot meta, `/api/panel/memory-sets` returns
  sets with six slots, wardrobe is three columns, set grant sends six commands.
- Restart the Electron app after renderer edits; then commit.

## 7. Traps that cost time before

- `dotnet build` fails with MSB3027/MSB3021 when the panel or server is running: stop the
  stack first, it is a file lock, not a code error.
- Backing up a live MongoDB fails with `EDOM` because WiredTiger locks its files. Stop mongod,
  copy, start again (the supervisor already does this).
- Two dbpaths (desktop `userData` vs `D:\mongo\data`) silently means two databases. The setting
  `mongoDataDir` must point at the folder that holds the real accounts.
- The in-game command layer answers "Player is offline!" without a live session. Administration
  must go through `/api/admin/*` instead of the command layer.
- `cmd //c robocopy` opens an interactive shell and copies nothing while exiting 0. Use
  `MSYS_NO_PATHCONV=1 robocopy.exe` directly.
- `Start-Process -RedirectStandardOutput` hangs when the child inherits handles; the control
  centre launches through `wscript` + `tools/hidden-launch.vbs` to stay invisible and detached.
- Browser automation cannot reach the Electron IPC bridge (`window.selena.adminToken`), so the
  Accounts tab can be verified by endpoint (curl) but not click-by-click there.
- MSYS path conversion is off: pass `C:/...` to native tools, not `/c/...`.

## 8. Next after this feature

Plan order is A, B, C, E, F, D (see `plans/2026-11-15_112155-inventory-ops-dashboard.md`):

- E mail, F updates (backup, pull, rebuild, restart), D character builder last.
- Accounts still needs currency, unlock character and max character through the admin channel.
- Character builder needs the rank and resonance model (S0-S10, SS, PPC skulls, memory
  resonance presets per construct) before any UI is worth building.