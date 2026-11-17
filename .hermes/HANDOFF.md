# Handoff — Selena-port, 18 Nov 2026 (~04:50 local)

Written because the owner is switching agents mid-investigation. Everything below is what was actually run and
observed tonight, not inference. Where something is still a guess it says so.

## Where things stand

- Branch `main`, HEAD `21cea02`. **One commit is local only** (`21cea02`); `origin/main` is at `49844c0`.
  Push needs the owner's explicit word.
- Latest release: **`v26.11.1802`** (assets `Selena-port-Setup-26.11.1802.exe`, `-Portable-`, blockmap).
  Version format is `YY.MM.DD`, plus a two-digit counter for a second same-day release (`26.11.1801`, `1802`).
  The workflow `.github/workflows/app-release.yml` releases only when `v<version>` does not exist.
- Running right now: mongod `9932` on 27017, AscNet `25108` on 2335/8085, 5 app processes. The stack was
  started by the app, so its Stop button works.

## Fixed and verified tonight

Server (reachable without a release, via **Config → Update source** which pulls and rebuilds):
- `LevelCommand` never saved, so an administrative level change was lost. Now saves (`SaveChecked`), and only
  asks a connected client to re-login on a downgrade. Verified: `level 9` read back from the accounts endpoint.
- `stage all` threw `Object reference not set…` because the offline administrative session never built
  `session.stage`. `AdminSession` now assigns `Stage.FromUid`, and stage writes save. Verified: `{"ok":true}`.
- Socket read timeout was 10 s and dropped a client that stalled mid-action; now 60 s.

App/panel (needs a release — these live in the asar and in `web-ui`):
- Accounts → **Edit** did nothing: the `#shellDialog` markup was missing from `desktop/ui/index.html`. Restored;
  verified end-to-end in the app window (dialog opened with the account's values, save updated row + log).
- Construct → **Tutti** now sits in the footer beside Silence and is visible before a character is picked. The
  bulk form also stopped showing only Level/Rank: the caps come from the character tables, so all four
  controls (Level, Rank, Promotion, Skills) are there without a pick.
- Rank ladder now walks S0..S10 → SS0..SS10 → … → SSS+ in both Tune and Tutti (it stopped at S9 before).
  **as is** exists in Tutti only; Tune opens at the target's base rank (S target → S0, A target → A0).
- Tune's resonance note explains the awaken rule and the workaround (see the domain rule below).
- `tableDir` now derives from `repoRoot` instead of a hardcoded packaged path, so "Game tables" no longer says
  "Clone repository below" when the checkout is already pointed at.

Setup/onboarding:
- App installs .NET SDK (per-user), Git (MinGit, release digest checked), MongoDB (manifest digest checked) and
  the launcher (release zip + digest), then clones/pulls and builds the server. Verified in a scratch profile
  end to end (all nine setup lines ready, Start brought the stack up).
- A real bug was fixed there: `extractZip` never created its destination, so the Git install failed with
  `tar: could not chdir` on every fresh install.
- `SELENA_USER_DATA=<dir>` runs the app against a scratch profile (read before the single-instance lock).

## Open issue: the client freezes ("Not Responding")

Two freezes were captured in `%APPDATA%\Selena-port\logs\server.out.log`:

1. 04:25 — last packet `Pong` at `04:25:35.135`, then silence, `Saving session state…` + `disconnected` at
   `04:25:45.211` (10.08 s — the old timeout).
2. 04:40 — last packet `PartnerSkillUpResponse`/`NotifyTask` at `04:40:43.675`, then silence, disconnect at
   `04:41:44.543` (60.87 s — the new timeout). Ping cadence before it: 04:38:01, 04:39:02, 04:40:06 (~60 s).

What this establishes: the server was idle and fast in both cases, and the **client stopped sending anything**
(pings included) until the read timeout closed the session. So the freeze is on the client side — the socket
thread going quiet looks like the game's own threads stalling, not the server being slow.

What is *not* established: why the client stalls (and whether the disconnect is a consequence or a cause). The
SDK duration logging I intended to add is **not in the tree** — `grep -n "Slow request" AscNet.SDKServer/SDKServer.cs`
returns nothing, and neither does the built DLL. Do not assume it is deployed; re-apply it if it is wanted:
`RequestLoggingMiddleware.Invoke` in `AscNet.SDKServer/SDKServer.cs`, wrap `_next(context)` in a `Stopwatch`,
append `" (N ms)"` to the log line, and `log.Warn` when ≥ 1500 ms.

Suggested next probes, cheapest first:
1. Client log: newest file under `%USERPROFILE%\AppData\LocalLow\kurogame\PGR\log\` around the freeze time.
2. Reproduce with client mods off (launcher `SETTINGS → CLIENT MODS`, restart the game) — the GM menu and mods
   are injected into the client and are the one component neither server nor panel can see.
3. Note whether the freeze follows a specific action (partner skill-up appeared minutes before freeze #2).
4. If it reproduces without mods too, the next instrument is on the client side (Unity profiler / `boot.config`
   logging), not in the server.

Do not chase "slow request" numbers in `server.out.log` until the duration patch is actually in the build:
every SDK line currently looks like `200 GET /path` with no timing.

## Rules this project cares about (learned the hard way)

- **The owner's account of a game mechanic outranks inference from tables.** They have played PGR for years.
  Implement what they state; never argue it away as "doesn't make sense". Recorded in `.hermes/state.md`,
  `selena-port-domain`, and memory.
- Resonance types: `EquipResonanceType` is **1 = Attrib (stat), 2 = CharacterSkill, 3 = WeaponSkill**
  (`AscNet.Common/MsgPack/Types.cs`). Awaken counts only a *skill* in the upper slot; a stat there does not
  count in this fork, which is a known fork bug (official servers count it). Workaround, also in the README and
  in the Tune note: set the upper slot to a skill → awaken → overwrite that slot with the stat in game; the
  awaken cannot be locked again.
- A running `AscNet.exe` keeps the code it started with. C# fixes need Stop → Start, and a build fails on file
  copies while the server runs (`MSB3027`, locked by `AscNet`). The same applies to `web-ui`/`desktop` changes:
  they live in the packed app, so a release is needed for players.
- Never grep `server.out.log` wholesale — it holds >1.7 M characters and will flood the context. Use
  `grep "Slow request"`, `tail -8`, or `cut -c1-140`.
- Untracked/unpushed: `21cea02`. Nothing else is dirty; `git status` is clean.

## Useful paths

| What | Where |
| --- | --- |
| App config | `%APPDATA%\Selena-port\config.json` |
| App/server/db logs | `%APPDATA%\Selena-port\logs\` (`app.log`, `server.out.log`, `mongo.out.log`) |
| Admin token | `AscNet/bin/Debug/net8.0/admin-token.txt` (proxies inject it; never print it) |
| Database | mongodb at 27017, db `asc_net` (collections `characters`, `accounts`, `players`, `inventory`) |
| Panel served by the app | `http://127.0.0.1:<ui-port>/player/index.html`, shell at `/ui/index.html` |
| ui-port | `%APPDATA%\Selena-port\logs\ui-port.txt` |