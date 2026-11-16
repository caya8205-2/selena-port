# Selena-port working state

Notes for whoever picks this up next, written by the agent that built it. `plans/` next to
this file holds task plans; this file holds what the code and the machine actually do,
so a fresh session does not have to rediscover it.

**Rule: update this file at the end of every piece of finished work.** Move items from
"work in progress" to "done and verified", correct any fact that changed, add new traps the
moment they cost time. A stale note is worse than no note, because it is trusted. When a
session starts without its earlier context, read this file first, then `git log -5`, then the
files it names. Do not rely on memory for ports, paths or column names.

Last updated: the docs were brought back in line with the code, and every panel select now builds the
bundled element through `SelenaUI.picker`, with the factory kept as the proven fallback. Section 8
lists what is still open; section 9 describes the build writer; section 10 carries the game
vocabulary.

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

    cd desktop && npm run dev      # dev mode: reloads the window on save, F12 devtools
    cd desktop && npm start        # same window without the file watcher

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
| Admin command channel | `POST /api/admin/command/{name}` (`AdminController.cs` -> `AdminSession.cs`), proxied to the pages as `/api/panel/command/{name}` by `desktop/main.js` |
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
- `scene` accepts `unlock <id>` and `unlock all` (the single-id form was added for the panel;
  before it, Perform had nothing to send and the tab was information only).
- The `equip` command accepts `add <id>` and `add all` only, with no type filter: Tutti in the
  Weapons or Memories section grants every equip of both kinds. Say so in the tooltip.
- Catalog endpoints: Node `desktop/main.js` (`/api/panel/catalog/<kind>`, `/api/panel/accounts`,
  now `/api/panel/memory-sets`) and, for parity, `AscNet.WebPanel/Catalog.cs`.
- **A construct has three progression genes, not one**: `Grade` (rarity ladder, `CharacterGrade.tsv`
  with `GradeName` such as "Private I"/"Sergeant I", promoted by `UseItemKey`/`UseItemCount`),
  `Quality` 1..6 (the rank ladder, promoted with `CharacterQualityFragment.PromoteUseCoin` of
  `PromoteItemId`) and `Star` 0..N inside that quality (shards of the construct's own
  `CharacterTable.ItemId`, cost `StarUseCount[Star]`). A quality step resets `Star` to 0.
  The plan's "S0..S10 then SS/SSS/SSS+" is this ladder, not a single field.
- Shard costs per star are 1/2/3/9/18 for qualities 1-5 (identical for all ten steps of that
  quality); promotions cost 20000/40000/60000/80000/100000 Cogs; quality 6 has no star steps and
  no promotion. The PPC's 50-per-construct price is the shop price, not the upgrade cost.
- The panel's "Acting as" is a database pick, not a sign-in: `AdminSession.Open(uid)` returns the
  live session when the player is in game and otherwise builds a socketless `Session` over the
  same `Player`/`Character`/`Inventory` documents, so `Command.Execute` runs unchanged. The
  response says `live: false` when the write only exists in the database.
- An offline session must never be built for a player who has a live one: two writers for the same
  documents would overwrite each other on the next save.
- The memory "hypertune" the plan describes is the game's **awaken**: `EquipAwakeRequest` adds a
  slot to `EquipData.AwakeSlotList` against a recipe, and `AwarenessModule.LeveledEvents` reads
  `1 + awakened slots` as the grid event level (Magic 763745000, +1% per level). Two awakened
  slots per memory are the 12% ceiling for six memories; Harmony memories cannot be resonated.
- **Harmony is a weapon overrun effect, not an extra slot**: `WeaponOverrun.tsv` rows carry
  `ConsumeItemIds[1]` 34000 x25, `ActiveSuitItemId` 47 x1200 and the text "Harmony Absorption:
  Piece count for Memory Set effects +2". `EquipData.WeaponOverrunData` persists
  `Level`, `ActiveSuits`, `ChoseSuit`.
- Resonance pools come from `EquipResonance.tsv` keyed by the equip id: a memory uses
  `AttribPoolId[1..3]` (slot 1) and `CharacterSkillPoolId[1..2]` (slot 2, chosen with
  `SelectSkillIds`); a 6-star weapon uses `WeaponSkillPoolId[1..3]`, and the pool row's
  `CharacterId` plus `SkillId` list is what gates a class-specific node.
- A mail is a `PlayerMail` with `Type` 0 and `GroupId` 0, exactly like `Configs/system_mails.json`;
  `ExpireTime` 0 never expires and the claim key falls back to `mail:{id}`. An online player gets
  `NotifyMails` pushed at delivery, an offline one gets the row at the next login.
- The welcome mail lives in `Resources/Configs/system_mails.json` and `MailModule.EnsureSystemMails`
  issues it at login to any account whose mail list lacks its `Id`. So the id decides the audience:
  keep it and only accounts that never received it (new ones) see the current text; change it and
  every existing account is handed the new mail at its next login, the old row included. It is
  branded to this fork now: gold sender `Selena-port`, English only, the free and no-payment
  statement the upstream authors wrote kept intact, still undeletable. The file is read at every
  login with no cache, but `AscNet/bin/Debug/net8.0/Configs` is a PreserveNewest copy, so the runtime
  file has to be updated too when the stack is not rebuilt.
- The login world-chat greeting (`AccountModule`, the seeded marquee message) is the second branded
  string and lives in C#: `Hello <name>! Welcome to Selena-port. Read your mail if you have not
  already.` It ships with a server build, so a change there needs the stack stopped, the build and a
  restart.
- Attachments are validated at creation by `MailModule.CreateAttachment`, which runs the same
  `TryProjectReward` the claim runs: equip/character/fashion ids must be count 1, item ids must be
  a client item id. Item ids that exist only in `BigWorldItem.tsv` are accepted (`999999`
  Babylonia Test Item), so "it is in Item.tsv" is not the test.

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
- Phase E mail: `mail send <uid|all> <itemId|0> <count|0> <subject> [body]` and
  `POST /api/admin/mail` (send) / `GET /api/admin/mail?uid=` (read one mailbox) both run
  `AscNet.GameServer/MailDelivery.cs`, so a panel send and an in-game send produce the same row.
  Verified by curl: single UID, `all` (2 accounts), item + equip in one mail, equip with count 2
  refused, unknown UID refused, impossible id refused, missing token 401, missing subject 400,
  and the read-back listed the mails. Verified in the shell page with a stubbed bridge:
  recipients, item search, attachment count, send, mailbox refresh.
  **Outstanding**: the in-game claim, one click with uid 2 logged in.
- Phase F updates: the Update tab reads local HEAD, branch, working tree and the tracked GitHub
  commit, and offers "Update now" only when HEAD differs and the tree is clean. Applying reports
  one line per step (working tree, branch, backup, stack, pull, build, restart). Verified through
  the real Electron IPC: a dirty tree refuses before any work; a real run backed up
  (`<stamp>_update`), stopped the stack, pulled `Already up to date.`, built, and came back
  listening; the same run against the real upstream aborted at pull with git's own
  "Not possible to fast-forward" and still restarted the stack; the Config "Rebuild server"
  button recompiled (dll mtime moved) with the stack originally running and came back up.
- Phase D, first half: `character info <id>` (progression, next step and its cost, shards,
  equipped memories and weapons with resonance/awaken/overrun), `character rank <id>
  [next|star|quality|max]` and `character shards <id> <count>` run through
  `AscNet.GameServer/CharacterProgression.cs`. `--character-builder-only` verifies them offline:
  one shard step, the refused early quality step, a greedy walk that spends exactly the table
  totals (300 shards and 240000 Cogs for Lee), a short balance that stops with the shortfall,
  and parity with `CharacterActivateStarRequest` on an identical player.
- Acting-account channel: `Session` learned to exist without a socket (nullable writer, one
  `internal` constructor), `AdminSession` picks live-or-database, and
  `/api/admin/command/{name}` (proxy `/api/panel/command/{name}`) runs any command for a uid.
  Verified by curl: item add and character info for an offline uid (both `live: false`), bad args,
  unknown command 404, no token 401. The player page now has no sign-in at all: the account panel
  and the rail's sign-in/status block are gone, the "Acting as" dropdown drives every command, and
  the shared action row gained Tutti (arm, then confirm within five seconds) for every section
  that can speak for all entries.
- Construct tune in one pass: `AscNet.GameServer/TuneBuilder.cs` writes level, rank, promotion, six
  memories with level, breakthrough, hypertune and two resonances each, the weapon with its three
  resonances and the harmony set. `POST /api/admin/tune` on the SDK is proxied by the shell as
  `/api/panel/tune`; the modal in `web-ui/player/player.js` fills its pickers from
  `/api/panel/tune-catalog` and `/api/panel/tune-character/<id>`, both built in `desktop/main.js`
  out of the tables alone, because no account is consulted to draw a form. Perform stays the only
  write, and the tune spends nothing: it writes state, it does not replay the upgrade curve.
- Resonance labels read from tables, never invented: a memory's upper slot (slot 1) lists the basic
  attack and the three orb levels (skill types 1, 2, 3, 4) and the lower slot (slot 2) the signature
  move, QTE, core passive and class skill (types 5, 6, 7, 9), both filtered by the construct through
  its skill groups. Slot 1 is the upper resonance and slot 2 the lower one. The type numbers were read
  inverted once, which is what put a signature pick where the client draws a red orb. Both slots offer
  the same four stat picks. Weapon resonance is named by pool position per class, with the class read from
  `Character.tsv.Career`. `06f98ec`, `af28547`, `a063f42`, `01891b1` and `2000307` are that pass.
- Weapon rarity gates the feature, in the writer: `TuneBuilder` refuses a resonance or a harmony on
  a weapon below 6 star, and the message names the weapon and its star. 5 star resonates flat attack
  only, 4 star is the default weapon and gets nothing custom; the panel shows that where it cannot
  offer the pickers. The refusal has no test flag of its own yet, so it is covered on the panel path
  only.
- Dorm and guild exist in the player panel: `dorm info|fill <room|all>` and
  `guild info|grant exp|fund|contribution <n> [confirm]`, both answered on
  `POST /api/admin/command/{name}` so the panel needed no new endpoint. `dorm fill all` granted 1008
  of the 1024 table pieces and a Cafe fill 18; guild grants move only their own store through
  `GuildModule.Commit`, and `fund` and `contribution` credit the same pool by design.
- Design pass, all in `web-ui/common/theme.css` plus the two panel stylesheets: five-line staff
  under the page title, a hairline `staff--corner` mark on a framed box, an iris watermark at 4.5%
  behind the Performance panel, a four-petal burst on a successful Perform, a three-bar score meter
  beside the preview, a spotlight gradient on rail hover, indigo `::selection` with pale gold text
  and near white Perform text. Rail icons are drawn per section: a butterfly for Coatings, a
  crescent for Scenes. `DESIGN.md` is the direction and `references/design-language.md` in the skill
  holds the measured contrast table.


### Scroll containers (one rule, keep it)

Containers never grow with their content. Which of them show a bar is a separate choice.

- panels: `.app { height: 100vh; overflow: hidden }`, `.main { min-height: 0; overflow: hidden }`,
  `.workspace { flex: 1 1 auto; min-height: 0; overflow-y: auto }`
- shell: `html, body { overflow: hidden }`, `.view { height: calc(100vh - 52px); overflow: hidden }`,
  `.frame { height: 100% }`; padded views (console/accounts/config/update) scroll inside
- wardrobe: `.grid__cards { max-height: 300px; overflow-y: auto }`, a short first page of 48
  cards, exact total printed next to "Show all N"
- **the action row is cleared on every section render** (`sectionActions.clear()` runs before
  any fields are built). Clearing only inside the custom renderers left "Unlock coating" sitting
  on Stages and Memories until a custom section happened to run again
- a section may declare `plan(values)` returning several commands instead of `build(values)`;
  Perform walks the list and logs one entry with a line per command
- a section may declare a `select` field (options loaded async, empty by default) and a grid
  with `catalogFrom(values)` plus `dependsOn`, which reloads when that field changes (coatings
  per construct). Rebuild only when the dependency value actually changed, otherwise the grid
  wipes the selection the player just made
- **no section-specific buttons exist**: every section is just `fields` plus `build(v)`, so
  Perform runs it, and an optional `allArgs(v)` gives Tutti its bulk form. Coatings picks a
  construct and performs `coating unlock <id>`; Scenes picks a background and performs
  `scene unlock <id>`. A custom renderer is reserved for a section whose form genuinely does
  not fit the generic one (player cleanup), never for adding another button
- the shared row is Tutti, Perform, Silence only, wraps inside the column (`flex-wrap`),
  carries `padding-top: 10px` and a top hairline; `sectionActions.clear()` runs on each render
- sticky was tried and reverted: it covered the catalog status line without buying anything
- `.console` is `height: max-content`: a fixed box clipped the action row as soon as a section
  carried two catalogs (coatings)
- **visible bars**: only the wardrobe's thin one. `.rail__nav`, `.workspace` and `.view` set
  `scrollbar-width: none` and zero width webkit bars: they still scroll by wheel, drag and
  keyboard, they just draw nothing. Two grooves next to the wardrobe bar was noise.
- scrollbar variables: `--scroll-size: 7px`, thumb `rgba(106,127,219,0.18)`, hover gold 0.38

Measured at 1366x764: GM wardrobe 300/936 with a thin bar, workspace 598/12744 with no bar,
player rail 642/743 with no bar and scrolling (scrollTop reached 60), shell page no scroll,
frame 1366x712. Watch the viewport when measuring: a browser daemon restart drops the metrics
override and every height reads short (a 764 window measured 429 and looked like a layout bug).

## 6. Memory slots, wardrobe columns, set grant (finished, one test outstanding)

- `Site` now drives the memory catalog in both servers: 0 is a weapon, 1..6 is the slot.
  690 memories ship with meta like `6★ \u00b7 Slot 2`; the Node source needs `invert: true`
  on the Site filter, because the rows that match `Site == 0` are the weapons (that mistake
  shipped once and made the memories catalog list 252 weapons).
- `GET /api/panel/memory-sets` (Node) returns 114 sets built from Equip.tsv by grouping on
  `SuitId`, keeping only suits with all six slots, e.g. Burana 1649 -> 3016049..3066049.
  This endpoint is Node-only; the .NET panel has no equivalent, so the widget hides there.
- Memories is a normal form now: an optional set select that starts empty, an optional memory
  grid, and an Amount field identical to the Items tab. Perform runs one `equip add <id> <qty>`
  for a single memory, or six of them for a set. With nothing chosen Perform is disabled. The
  separate "Grant set" button is gone, and so is its widget.
- `grid()` honours `field.columns === 3` (`.grid__cards--three`), so the memories wardrobe
  reads three per row, slots 1-3 above 4-6, the same order as the game.
- Both panels: `memories` section carries `setGrant: true` and `columns: 3`;
  `grantMemorySet(set)` sends one `equip add <id>` per slot in order and reports
  "all six granted" or "N of 6 granted".
- Verified in the running app: GM and player both show 3 columns, 600 cards drawn of 690 with
  the remainder stated, card meta `1★ \u00b7 Slot 1`, widget listing 114 sets starting at
  Aife, no console errors.
- Outstanding: the grant itself has never been executed against a live session, because the
  client was not logged in. It needs one click with the game online. GM keeps its Tutti; the
  player panel has no Tutti by design.

## 7. Traps that cost time before

- `dotnet build` fails with MSB3027/MSB3021 when the panel or server is running: stop the
  stack first, it is a file lock, not a code error. Both build paths now stop it themselves
  (`stopStackFor`), and the app's own child list is not enough: a stack started from `tools/`
  belongs to the control centre, so the stopper falls back to that script and waits for the
  ports, not for the pids.
- `AscNet.exe` is a framework-dependent apphost: started without `DOTNET_ROOT` it dies with
  "You must install .NET ... Failed to resolve hostfxr.dll" even though the SDK is on PATH.
  `main.js` now discovers the runtime directory (DOTNET_ROOT, else the `dotnet.exe` found on
  PATH, else `%LOCALAPPDATA%\Microsoft\dotnet`) and passes it to the build and the server.
- `tools/.run/*.pid` are tracked files and the control centre deletes them on stop, so every
  stack stop makes the working tree dirty (`D tools/.run/*.pid`). The update flow refuses a
  dirty tree, and a commit made after a stop records the deletion: `git checkout -- tools/.run`
  first.
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
- The two panels keep separate section tables with slightly different shapes (`gm/console.js`
  has `allArgs`, `player/player.js` does not). A patch written against one silently does not
  apply to the other, and the panel then throws `Cannot read properties of undefined
  (reading 'title')` when that rail item is clicked. Patch both, then click every rail item.
- Nested scroll containers add up fast: a page-height `.app`, an `overflow: auto` view in the
  shell and a `max-height` card grid produced four bars on one screen. Fix the container
  heights, not the scrollbar styling.
- In dev the shell watches `desktop/ui`, `web-ui` and `web-ui/common` and reloads the window
  (and therefore the iframes) on save, debounced 180ms; the log prints `[dev] reloaded: <file>`.
  Restarting the whole app is only needed for `main.js` itself.
- The app serves its own CSS/JS, and Chromium cached them: a stylesheet fix looked like it had
  no effect while the old layout kept rendering. `serveFile` now sends `Cache-Control: no-store`.
  If a layout change seems ignored, check the served headers before editing the CSS again.
- A wrong filter direction fails quietly: `catalog/memories` returned 252 weapons and looked
  plausible until the names were read. Check a catalog by a known row, not by length alone.
- In an async DOM handler `event.currentTarget` is null after the first `await`; read the value
  into a local first. The mail item search looked dead because of exactly that.
- Mongo naming: the collection is `players`, `PlayerData.Id` is stored as the nested `_id`, and a
  mail's `Id` is stored as `_id` too. A `$pull` keyed on `id` matches nothing and still reports
  success, so print the document before and after.
- `uv run --with pymongo python -` reads or patches the database with nothing installed into the
  project; no mongosh ships with the MongoDB zip.
- This machine has the .NET 10 SDK and only the 10 runtime: a net8.0 test binary refuses to start
  ("You must install or update .NET") unless `DOTNET_ROLL_FORWARD=Major` is set. The server itself
  is launched by the control centre, which sets up its environment.
- A socketless `Session` is enough for the command layer, but only because `writer` is nullable and
  every send path checks it; anything that assumes a client (disconnect, packet probes) must stay
  on the socket path.
- `AscNet.Test` does not load the command layer by itself: call
  `CommandFactory.LoadCommands()` before `CreateCommand`, or every lookup returns null.
- `Inventory.Do(id, negative)` clamps at zero instead of refusing, so every spend in a command
  has to check the balance first or it grants the rank and eats the stack down to nothing.
- The shell page served over HTTP has no `window.selena` (the bridge is Electron IPC), so a
  layout or flow test needs `Page.addScriptToEvaluateOnNewDocument` with a stub that returns the
  real token from `admin-token.txt`. That worked for the whole Mail tab, send included.
- A probe that reads `.sel__option` across the whole page collects the stale list of every picker
  opened before it, because a closed popover keeps its rows. Scope the query to one control's own
  `.sel__pop`, or the reading mixes two lists and looks like a control that ignored a pick.
- A tip on the element host answers for the whole box and hangs over the open list. Pass the tip as
  the `tip` property: the element forwards it to its inner button, which is the target that
  describes the control.

## 8. Remaining work

The list lives in `plans/2026-11-16_081900-remaining-polish.md`; this is its state on disk, checked
against the code.

- Task 1, design details: shipped except a reduced-motion guard (the petal burst, the meter and the
  rail spotlight animate with no `prefers-reduced-motion` rule anywhere) and the author credit line,
  which waits for the owner's text. The score meter stays hidden when idle instead of drawn still,
  because three static bars at 12px read as an ellipsis.
- Task 2, tune presets: not started. It waits on the owner's choice of memory and weapon defaults
  per preset; a preset fills the modal and Perform stays the only write.
- Task 3, harmony confirmation: waiting on the owner's end-to-end test. Do not change the writer
  before that answer: whether the two piece effect needs `WeaponOverrunData.Level` raised first is
  still unknown.
- Task 4, weapon catalog edge cases: the `EquipType` question (all three Lee frames share 1, so they
  see each other's weapons) is the owner's to confirm; the `Level = 0` case follows task 3.
- Task 5, the remaining panel selects: the form selects in both panels and the ones inside the tune
  modal now build the bundled element, with the factory kept behind it as the fallback. See the Lit
  components note in section 10.
- Task 6, testing owed: dorm and guild Perform from the panel against uid 2, a tune with a full six
  memory build and a 6 star weapon followed by a client login, and the shell account list, which
  needs the real Electron window because it reads the preload bridge.
- Accounts still needs currency, unlock character and max character through the admin channel.
- Mail stays send-only by design, and one in-game claim of a panel mail has not been clicked.


## 9. Construct build: piece work and the tune writer

- `character info <id>` reads a build: progression, the `next` step with its cost, the account's
  memories (worn first, then the spare pile) and the weapons.
- `character rank <id> [next|star|quality|max]` walks `Grade`/`Quality`/`Star` with the table's
  costs. Every step pre-checks the balance because `Inventory.Do(id, -n)` clamps to zero instead
  of refusing, so a short stack would otherwise eat the shards and grant nothing.
- `equip feed|break|awake|resonate|overrun` are thin commands over `RequestBridge`: the handler the
  game registers for `Equip*Request` runs with a real session, so a command cannot invent a cost,
  a level curve or a refusal. `--equip-builder-only` covers all five end to end.
- The panel's Construct tab reads the build and then edits one piece at a time: rank buttons,
  feed to cap, breakthrough, awaken (only enabled for a slot that already holds a resonance,
  because the handler needs one), resonance picked from `/api/panel/resonance/<template>/<slot>`,
  and weapon overrun. Every control carries a tooltip.
- The memory pile can run to hundreds of rows (`uid 2` holds 654 spare memories from grant tests),
  so the table shows a filtered window of 40 and says how many it hid.
- `/api/panel/resonance` also reports `selectItemId`: `EquipResonanceUseItem.tsv` often has an
  empty `SelectSkillItemId[1]` for generic sets, and the server refuses every resonate request for
  such an equip - the panel disables the button and says why instead of offering a dead action.
- Tables worth remembering: a memory's pools are `EquipResonance.tsv` columns `AttribPoolId[slot]`
  and `CharacterSkillPoolId[slot]`; a weapon's is `WeaponSkillPoolId[slot]` resolved through
  `WeaponSkillPool.tsv`. Generic sets carry four attrib entries on both slots.
- An admin `equip add` leaves a memory unbound (`CharacterId` 0); the game binds it when the client
  equips it. The panel marks those rows `spare`, so a build made of grants reads honestly.

### The tune writer

`AscNet.GameServer/TuneBuilder.cs` writes a whole build in one pass, and it is the one place that
does not replay the upgrade curve: it reads no account, spends no shard, cog or item, and states the
build it was given. `POST /api/admin/tune` takes a `TuneRequest` and answers a `TuneReport`; the
shell proxies it as `/api/panel/tune`.

- Request: `character {level, quality, star, grade}`, up to six `memories [{slot, templateId, top,
  bottom}]`, one `memoryLevel` shared by those six, one `hypertune` switch, and one
  `weapon {templateId, level, resonance[3], harmonySuit}`.
- Out of range values are clamped, not refused: level to the `LevelUpTemplateId` maximum, quality to
  `[base gacha rank, table maximum]`, star to that quality's star step count (a star carried into
  SSS+ is dropped), grade to the table maximum. A template that is not a memory or not a weapon in
  `Equip.tsv` is refused by name.
- A memory the construct already holds is reused, so its equip id stays stable across tunes; a build
  that names fewer than six removes the stale rows, because a seventh memory keeps showing in the
  client grid. Both resonance slots are written here and a resonance is what binds the memory to the
  construct, so no later equip step has to do it.
- Hypertune is the awaken state: `AwakeSlotList` holds the resonance slots that exist, which is what
  `AwarenessModule.LeveledEvents` counts. A slot with no resonance has nothing to awaken.
- Harmony writes `ChoseSuit`, appends the set to `ActiveSuits` and sets `Level` to the highest
  `WeaponOverrun.Level` the weapon has. A weapon with no `WeaponOverrun` rows keeps `Level` 0, and
  whether that blocks the two piece effect is still the open question in section 8.
- Rank and promotion in the report are labelled from the tables (`RankName`, `PromotionName`), never
  from a hand map.
- A tune edits a build instead of resetting it. Every control starts on the state the character
  already carries (memory slots, both resonances per memory, weapon with its level, resonances and
  harmony, current skill level), and the writer replaces only what the request states:
  `MemoryLevel` 0 keeps each memory's level, `Hypertune` null keeps each memory's awaken state,
  `SkillLevel` 0 keeps the levels, a memory resonance slot that is not named keeps its pick (an
  explicit `TemplateId` 0 clears it), an empty weapon resonance list keeps the weapon's picks, and
  `HarmonySuit` null keeps the harmony. Perform on an untouched form is a no-op. It used to wipe a
  built memory's resonances because the panel sent empty pickers.
- Skill levels are part of the build: `SkillLevel` on the request raises every skill of the
  construct, one entry per skill group. The writer runs the login reconciliation first
  (`UnlockQualityGatedSkills` plus `NormalizeCharactersForCurrentTables`), because a fresh row holds
  three skills and only then does the rest of the kit exist, and it clamps each level to what
  `CharacterSkillUpgrade` sells: 18 for a normal skill, 1 for a passive. `CharacterSkillLevelEffect`
  runs to 35 and must never be the ceiling here, because those rows already describe a built memory:
  six lower resonances add six levels on top of the bought 18, which is how the signature shows 24.
  Rank changes scaling, not skill levels. The panel's slider reads the same 18 through
  `/api/panel/tune-character`.
- A memory may legally hold one resonance, so the writer does not refuse an empty slot. The panel
  reports it instead: after a write it counts the memories whose report entry carries fewer than two
  resonances and names the slots in the note. A slot left empty also keeps that memory out of
  `AwakeSlotList`, since there is nothing to awaken.
- The write alone is invisible to a client that is in game: it keeps the construct and the gear it
  was handed at login. So the writer pushes `NotifyEquipDataList` (every memory and weapon it wrote,
  plus the ids of the stale rows it removed) and `NotifyCharacterDataList` after `Save`, which is
  what every handler that changes a construct or a piece of gear does. A socketless session has no
  writer and `Send` drops the frame there, so an offline tune just stores. The regression is
  covered: `--tune-builder-only` reads the frames off a loopback session and fails when the pushes
  are missing.


## 10. PGR domain model, in the game's own words

Written down because the panel is for players, and every internal name here has a
player-facing name that must be used in copy, in labels and in this file.

### Rank, promotion, level

- `CharacterData.Quality` 1..6 is **Rank**: 1 B, 2 A, 3 S, 4 SS, 5 SSS, 6 SSS+.
  Inside a rank there are 10 star steps (`CharacterData.Star` 0..10), so the ladder
  runs S0..S10, then SS0..SS10, then SSS0..SSS10, then SSS+. Star is an internal
  step marker with no fan name; never show "Quality" or "star" to a player.
- Quality 6 (SSS+) has no star step. A star carried into it is dropped, not invented.
- `CharacterData.Grade` 1..14 is **Promotion**: Private I, Sergeant I, Sergeant II,
  Elite I-III, Task Force I-III, Ace I-IV, Hero. Cogs buy each step
  (`CharacterGrade.UseItemKey`/`UseItemCount`). It raises stats and is the level
  ladder the player recognises.
- Base rank is the gacha rank: `CharacterQuality.tsv` row per CharacterId, min
  Quality wins. A tuned rank never goes below it. An A-rank construct pushed to
  SSS+ is still an A-rank construct: base rank decides how strong it is, never the
  rank label alone. Players get tricked by exactly that.
- Tuning writes state directly. It does not replay the upgrade curve and spends no
  shard, cog or item: the cost per step differs (3 shards S0 to SS0, 9 after that,
  and so on), so charging would make the builder unusable and the numbers would
  never match.

### Memory resonance (two slots per memory)

Both slots offer the same four stat picks, the "Ex -" entries from
`AttribPool.tsv` (`EquipResonance.AttribPoolId[slot]`). The skill list differs:

- Upper, slot 1: basic attack and the three orb levels (types 1-4). Slot 1 is the upper resonance.
  level. These are `CharacterSkillType.Type` 5, 6, 7 and 9.
- Lower, slot 2: signature move, QTE, core passive and class skill level (types 5, 6, 7, 9). Both
  slots still offer the same four stat picks.
  These are types 1, 2, 3 and 4.

The pools live in `EquipResonance.CharacterSkillPoolId[1..2]`, but the game's own
validator (`EquipModule.EquipResonanceRequestHandler`) checks a pick against the
pool at `slot - 1` and the character's skill groups, so a writer must accept the
type pairing rather than only that pool index. Skill display names are client
localisation and are not in any table this server ships: label by type, which is
identical for every construct.

Storage: an attrib resonance keeps `ResonanceInfo.CharacterId = 0`; a skill
resonance carries the construct id. `EquipData.AwakeSlotList` holds the slot
numbers themselves (1 and 2), not slot + 1, and Hypertune means both are present.

### Weapon resonance (three slots) and harmony

Every weapon pool (`WeaponSkillPool`, keyed by CharacterId, 16 columns) carries the
same twelve ids in the same order: `101, 102, 103, 201, 202, 203, 500, 506, 511,
512, 513, 514`. The pool order is the in-game screen order, so names are assigned
by position, and the names differ per class:

- Positions 1-3 are named by frame kind. Omniframe: Incandescence, Dead Line
  Timing, Matrix Lightning. Uniframe (Vanguard only): Matrix Outburst, Overload
  Signal, Limit Break.
- Positions 4-6 are the same everywhere: Shock Saturation, Nsec Transmission,
  Shock Echo.
- 7 onward is the class block:
  - Attacker, Annihilator: Glorious Afterglow only (Annihilator is an Attacker
    with extra mechanics, same generation, not an evolution).
  - Tank: Resonant Echo, Domain Deconstruction, Boundary's Annihilation, Gravity
    Barrier, Absolute Defense.
  - Breaker: Glorious Afterglow plus the five tank entries.
  - Support, Amplifier, Overlinker: Glorious Spear, Superconducting Axial Ray,
    Honed Gel, Stellar Magnetic Rail, Peaceful Radiant.
  - Observer (Ishmael): the amplifier five then the tank five, 16 entries. The
    squad screen picks which class Ishmael plays; the weapon resonance screen
    always offers both, so it is not gated by the squad class.
  - Vanguard: no class block at all, only the six frame entries.
- Dead Line Timing is the one every rotation depends on: 2 orbs on deploy, then 3
  orbs every 45 seconds. Without it many constructs are unusable because their
  rotation is too short to cycle switch cooldowns. Matrix Lightning is the other
  universal must-have (movement speed, 10% less enemy damage reduction inside a
  matrix).

Rarity gates the feature, not the class: 6 star weapons take custom resonance and
harmony, 5 star resonates flat attack only with no custom pick and no harmony, and
4 star is the default weapon that gets nothing custom.

Harmony is `WeaponOverrunData`: `ChoseSuit` is the memory set id, `ActiveSuits` the
sets it can borrow, `Level` the overrun level. The player picks a **set**, never a
memory: an active harmony counts as two pieces of that set, so four signature
memories plus harmony already complete a four piece bonus. The table text says
"Piece count for Memory Set effects +2" for the same reason.

### Class mapping

`Character.tsv.Career` (column 25) indexes `CharacterCareer.tsv`
(`Type` -> `Name`). It is the only source; `Character.tsv.Type` is the exp
template and is 1 for almost everyone.

| Career | Class | Weapon resonance block |
|---|---|---|
| 1 | Attacker | Glorious Afterglow |
| 2 | Tank | tank five |
| 3 | Support | amplifier five |
| 4 | Vanguard | none (Uniframe) |
| 5 | Amplifier | amplifier five |
| 6 | Annihilator | Glorious Afterglow |
| 7 | Observer | amplifier five + tank five |
| 8 | Breaker | Glorious Afterglow + tank five |
| 9 | Overlinker | amplifier five |

Verified one construct per career: Lee Palefire 1, Nanami Storm 2, Liv Eclipse 3,
Camu Crocotta 4, Liv Empyrea 5, Luna Oblivion 6, Ishmael Parhelion 7, Rosetta Arete
8, Adelyde Anabasis 9.

Vanguard exists only for Uniframes, four of 96 constructs, and an all-burst kit
that cannot be mixed into an Omniframe team. The owner considers the whole frame
type abandoned; it stays mapped for completeness, not as a target.

### Naming rules for the panel

Player vocabulary only, English, no internal ids in copy, no em dashes, one
tooltip per control. Rank, Promotion, Memory, Resonance, Hypertune, Harmony,
Weapon, Construct. Never "quality 3" for S, never "awaken" for Hypertune, never
"skill 101217". State is not the same as power: show base rank next to tuned rank.

### Operational lessons

- The running `AscNet.exe` executes the code it was started with. A C# fix is not
  live until the process is stopped, rebuilt and started again. Verifying a write
  against a stale process measures the old behaviour.
- `AscNet.exe` and stray `.NET Host` processes lock `AscNet/bin`: kill them before
  `dotnet build AscNet/AscNet.csproj`, or the build fails on copy after a clean
  compile.
- Health probes must not open a TCP connection to the game port: the server treats
  it as a client, opens a session, saves state and disconnects, which floods its
  log and can race a real login. Read the process instead.

### Panel conventions, learned the hard way

- The shell stores the current tab in `selena.view`. Before that it had no memory, and since the
  dev watcher reloaded the whole window on every save, opening a panel looked like the app jumping
  back to Console on its own. A save under `web-ui` now reloads the frames only; only an edit under
  `desktop/ui` reloads the shell.
- A tooltip belongs on a small target. The acting-as tip sat on the label that wraps the account
  control, so the whole header row answered for it and the tip stayed up while the list was used.
- Controls take their own width. A switch inside a grid row stretched to the row, so its tooltip
  answered from the far edge of the modal.
- Editing markup by slicing text can leave a closing tag behind: an extra `</div>` closed the shell
  early and the player page went blank. After any structural edit, count `<div>` against `</div>`
  and `<section>` against `</section>` before declaring it done.
- A native control that only holds a value stays in the DOM (`.is-mirrored`, `aria-hidden`, out of
  the tab order) so old readers keep working, while the visible control is the panel's own.

### Lit components

`web-ui/common/components/index.js` defines `sel-select`, `sel-toggle` and `sel-slider` as thin
wrappers over `SelenaUI.select`, `toggle` and `slider`, no shadow root so `theme.css` tokens still
apply. `desktop/build-components.mjs` bundles them with esbuild (`nodePaths` into
`desktop/node_modules`, because the sources live under `web-ui`) to `web-ui/common/components.js`,
which the panel server already serves. The bundle builds and defines all three elements.

`SelenaUI.picker(options, settings)` in `ui.js` is the single shape every call site uses now: it
answers the element when the bundle is on the page and the factory control when it is not, with the
same handle (`node`, `value()`, `setOptions`, `setValue`, `setDisabled`). The form selects in both
panels, the pickers inside the tune modal and both acting-account pickers go through it, so a page
never learns which control it got. The fallback is proven by loading a page with `components.js`
blocked: the same lists render from the factory.

A tip travels as the element's `tip` property, never as a `data-tip` on the host: the element hands
it to its own button. A tip on the host answers for the whole box, including the open list, and hangs
over it.

### Browser harness on this machine

The harness keeps one endpoint per session as `bu-<name>.port` and `.pid` under
`%USERPROFILE%\.config\browser-harness\runtime`. If the daemon dies those files are left behind and
the next call fails with `Access denied` while unlinking them, which looks like a broken page. Kill
stray `chrome.exe`, delete the stale `bu-<name>.*` files, and open the next session under a new name.
