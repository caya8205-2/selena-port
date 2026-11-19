# Handoff — Selena-port, 19 Nov 2026

## Current update: verified endgame and CUB tuning

The owner verified the current changes in game on 19 November: all reported score and ice-team preset fixes work.
The sections below this update describe the previous 18 November investigation; their process IDs, release and
working-tree status are historical, not the current runtime state.

- Rank & weekly offers War Zone tier, element-group, Mob/Elite/Boss and affix-zone picks, plus normal PPC
  Standard/Ultimate grades and named weekly boss picks. Changes push to the connected client immediately.
- Replacing a WZ zone or PPC boss removes its outgoing score while unchanged encounters retain theirs;
  rank/grade changes clear incompatible scores. Returning to an old encounter does not revive discarded scores.
  Reapplying a selection also removes stale inactive score records left by the earlier bug.
- CUB has a catalog with individual Tune and bulk Tutti controls for level, rank and skills.
- The ice-team preset failure was Vulpecula carrying four passive skills at a quality allowing only two,
  not the number of saved presets. Tuning now reconciles worn skills and saved presets against table capacity,
  including same-rank repair. Relog after repairing existing saved presets to refresh the client cache.
- Focused endgame, CUB and shared-stage arena score tests pass; the new regressions fail against the old runtime.
  Broader preset, partner-wear and Simulated Battlefield checks encountered unavailable local MongoDB;
  do not describe the full harness as green. The owner subsequently confirmed in-game functionality.
- The owner authorized committing these changes, bumping to `26.11.19`, and pushing to `origin/main`.
  The existing App release workflow publishes after a version bump; edit its generated notes after publication.
  Release notes should describe the player-facing features and fixes, not internal development history.

### Next update: PPC Intensive Battle (IB) picker

Deferred, not implemented. Extend the existing Rank & weekly panel; do not create a separate admin surface.
IB boss and elemental-stage selection are not currently adjustable, and this limitation must appear in the
`26.11.19` release notes.

Owner-stated mechanics and scope:
- IB is available only in PPC Ultimate, after clearing Ultimate above 1.8 million score.
- One boss rotates weekly, with three stages having different elemental weaknesses.
- The leaderboard uses the highest two stage scores; clearing all three stages is not required.
- Add control over the IB boss and elemental stages for sandbox team/build/rotation experiments without waiting
  for the retail weekly rotation. Preserve these mechanics and verify the client contract before implementation.

### Deferred nonfatal bug: A-rank CUB display and tune mapping

Owner report, not yet investigated: a naturally A-rank CUB already appears as S rank in the CUB section before
any tuning. Selecting level 30, skill level 5 and rank SSS in Tune produces rank SS in game.
The CUB identity and underlying cause are not established. Reproduce the initial display and submitted/applied
rank mapping against that CUB's authoritative tables and client contract; do not assume it shares the passive
capacity bug or silently offset all ranks. Leave this for later as requested.

## Historical handoff: 18 November

Written when the owner switched agents mid-investigation. Observations below belong to that earlier session.

## Where things stand

- Branch `main`, pushed to `origin/main` with the owner's explicit word (client freeze fix + `26.11.1803`).
- Latest release: **`v26.11.1803`** (assets `Selena-port-Setup-26.11.1803.exe`, `-Portable-`, blockmap).
  Version format is `YY.MM.DD`, plus a two-digit counter for a second same-day release (`26.11.1801`, `1802`, `1803`).
  The workflow `.github/workflows/app-release.yml` releases only when `v<version>` does not exist.
  Release notes are manual: the action publishes with `--generate-notes`, then edit via `gh release edit`.
- Running right now: mongod `9932` on 27017, AscNet `25108` on 2335/8085, 5 app processes. The stack was
  started by the app, so its Stop button works.

## Fixed and verified tonight

Client hard-freeze ("Not Responding", force-close only) — root cause was an undrained stdout pipe, not device load:
- The app spawned PGR.exe with a piped stdout nobody reads. Unity's own log writer blocks in `NtWriteFile` once the
  pipe fills, holding Unity's logging critical section; the main thread (Lua `Debug.Log`) then deadlocks on it.
  Two hang dumps proved it (main thread in `NtWriteFile` from a KRSDK `println!`, then main thread waiting the Unity
  log CS held by a Unity log writer stuck in `NtWriteFile`).
- Fix: `desktop/main.js` `launchClient` now spawns with `stdio:'ignore'` (no pipe). Patch logging is non-blocking:
  `AscNet.Patch/diag.rs` queues to a background writer, and krsdk's 145 raw `println!` go through a `kr_log!` macro
  into that queue, so no game thread ever writes stdout.
- Verified: 47 min play plus heavy UI (team presets for every element, manual character/memory/CUB leveling,
  Warzone/PPC prep) with zero freezes; previously froze at ~17-19 min. Needs the rebuilt portable (asar), not just repo.

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

- **The owner is Caya, the user you are talking to.** What they say about a game mechanic outranks inference
  from tables, DB, or server code: they have played retail PGR for years, and this is an unofficial emulator
  whose data is incomplete and sometimes wrong. Implement what they state; never argue it away as "doesn't
  make sense" or prefer a table over their firsthand account. Recorded in `.hermes/state.md`,
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