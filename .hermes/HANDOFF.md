# Handoff — Selena-port, 20 Nov 2026

## Current update: 26.11.20 (Accounts tab, IB picker, CUB rank fix)

The owner verified the CUB rank fix in game and authorized the `26.11.20` release. This
update ships three things on top of `26.11.19`:

- **Accounts tab, account detail block** (desktop/ui + new admin endpoints): picking a
  roster row shows the account's seven currencies (Black Card 2+3 pair, Cogs, Rainbow
  Card, Serum, Dorm Coin, Decor Coin, Simulation Score 105) with set-to-value inputs,
  Perform and Max all, plus six account-wide action buttons that reuse the existing
  flows (tune-bulk, tune-cub-bulk, character add all, stage all, scene unlock all,
  coating unlock all). New server surface: `AdminCurrency` (Describe/Apply),
  `Inventory.SetExact`/`SetBlackCard`, `GET/POST /api/admin/accounts/{uid}/currencies`.
  A set is an assignment, not a grant; the whole request validates before any balance
  moves (a live session persists in-memory mutations on its next save).
- **UID rename in the Edit dialog**: `POST /api/admin/accounts/{uid}/uid` via
  `AdminUid.Rename` rewrites the uid across accounts, players, characters, inventory,
  stages, the three leaderboard collections, guild membership fields and the PvP
  defence outbox; refuses taken/same uids, missing accounts and logged-in players.
- **Command message semantics**: `/api/admin/command/{name}` answers
  `CommandMessageCallbackException` as `ok` with the command's message (the chat path
  always showed it verbatim; the endpoint used to 400 successes like "Unlocked 5 scene
  background(s).").
- Also in this release: the IB picker (previous session) and the CUB rank-ladder fix.
  The release notes must say the IB picker shipped and the CUB rank bug is fixed,
  replacing the `26.11.19` caveats.

Verified on 20 Nov: currency set/clamp/pair split in the database, clean rejections,
live push, the rename round-trip (uid 3 -> 10 -> 3) across all collections, the dialog
flows in a browser harness, and the owner's in-game CUB read-back.

## Previous update: verified endgame and CUB tuning

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

Implemented in the working tree after the `26.11.19` release (uncommitted as of 19 November); live app
verification pending. The `26.11.19` release notes say IB selection "is planned for the next update"; when this
lands in the next release, the new release notes should say the picker shipped.

- Client contract: IB is the PPC challenge (凹分区) — `BossSingleChallengeGrade` LevelType 9, `NeedGradeType 4`
  (Ultimate), `NeedScore 1800000`, `BossGroupId 12` (7 sections × 3 element-weakness stages), `RankStageNum 2`.
  The weekly section and affix set resolve from `BossActivityNo` hashes unless `BossChallengeSelectedSection`
  (section **table row id**, not the logical SectionId — rows 89-108 map to 2025-2044) or
  `BossChallengeSelectedFeatureGroup` is pinned. Affix sets = `BossSingleChallengeFeatureGroup` rows 1-12/101-106
  (18 resolvable; stage i pairs feature i and buff group i positionally, `xbosssinglechallenge.lua:22-26`).
- `BossSingleChallengeFeature.tsv` gained the client `Name` column (87 rows, decoded from
  `resource/matrix/73f558bc5dd700c8.uab`, 0 shared-cell diffs; only normalization was empty-vs-0 ScoreRate).
- Server: `BossModule.ApplyAdminChallenge` pins section + feature group (validated against Group 12 and the
  feature-group table), invalidates an in-flight IB fight, saves, and pushes `NotifyFubenBossSingleData`.
  `EndgameBuilder` exposes `Boss.Intensive` (gate, sections with boss names + 3 stages, affix sets with the
  three affix names, current board, stored pins) and accepts `ChallengeSection`/`ChallengeFeatureGroup` in the
  apply request (null = keep; 0 = back to rotation). A pin written before the 1.8M gate is met lands at the
  first login that clears it.
- UI: an "Intensive Battle" block under Pain Cage in the Rank & weekly panel with Boss + Affix set pickers
  (Auto/rotation default, same picker pattern), a locked hint below the gate, and IB lines in the Perform note
  and result log.
- Tests: `Program.Endgame.cs` covers the catalog shape, the 1.8M gate lock/unlock, pin persistence as table row
  ids, the login-data push, invalid-section rejection, and replaced-boss score isolation via
  `AdminChallengeDisplayTotal`. `--endgame-only`, `--tune-cub-only` and `--arena-effect-zone-score-only` pass;
  DB-backed harness tests remain blocked by local MongoDB being down.

#### Bug 1: `Intensive Battle` showed `undefined` in the panel (fixed)

`pickRow` takes the picker wrapper (`{node, ...}`) and appends `control.node`; the IB block passed
`ibSectionPicker.node` (a DOM element) so `control.node` was `undefined`. Both IB rows now pass the wrapper.

#### Bug 2: IB modules did not match the stage element (fixed; AscNet policy)

Owner report: stage 1 Physical showed an Ignition module, stage 3 Raydiance showed a single "except Fire"
module, only the Ice stage was right. Cause is data, not the client: the client zips
`FeatureGroup.FeatureIds[i]` with `BuffGroupIds[i]` by position, and the shipped feature group it pinned
(Id 4) pairs Physical with the Ignition module (1009) and Raydiance with the Fire module (1003). Retail binds
boss↔affix through `BossSingleChallengeGroupDistribute`, reached from `BossSingleChallengeGrade.DistributeId`
(= 3). That table is not in the repo, not in the share bundle, and the client's
`XFubenBossSingleConfigModel` does not load it at all, so nothing authoritative here says which affix set a
boss gets.

AscNet policy fix, derived from tables only (no element names in code):
- `ChallengeElementClassByBuffGroup`: each buff group's module id is its element class (`Buff[1]` at `Index == 1`;
  the 1xx single and 2xx pair variants share it).
- `ChallengeElementClassByFeature`: each affix's element is the majority vote of the modules it is paired with
  across all coherent rows.
- `IsCoherentChallengeFeatureGroup` keeps only sets whose every affix matches its module's element;
  `CoherentChallengeFeatureGroups` = 17 of 18 shipped sets. The rotation hash, the catalog list, the pin
  validation and the buff-group lookup all use the coherent list, so the incoherent set can never be pinned.
  `--endgame-only` asserts the catalog offers 17 sets and never Id 4.

Caveat: 17 sets × 7 sections is still an arbitrary pairing (no retail boss→affix data exists here); the
filter only guarantees each stage's module matches its own element. Do not describe it as retail parity.
Stage element itself comes from `BossSingleStage.BuffDetailsId` (client-only BabelTower table), which the
server does not use.

#### IB panel notes (added)

Mirroring the War Zone zone hints: each stage of the chosen stage set lists the affix it carries and the
buff that affix applies, which is the stage's elemental weakness note. Module lists are deliberately not
shown — the in-game card already lists them. `BossSingleChallengeFeature.tsv` also gained the client `Desc`
column (87 rows, merged from the same decoded tab), and IB sections were added to `Boss.SectionNames` so the
picker shows the boss name instead of "Section N". The picker row is labelled "Stage set" (one boss, three
fixed element stages, matching retail) rather than "Affix set". All note text is table-derived.

#### PPC weakness notes + Babel table (added)

Each PPC boss picker now lists the stage's element weakness and what it does, e.g.
`Stage 3 · Frost — The phenomenon of freezing expansion will occur at low temperatures. Ice DMG received is
increased…`. Source is `BossSingleStage.BuffDetailsId[1..2]` (new TSV columns) resolving through
`Resources/table/client/fuben/babel/BabelTowerBuffDetails.tsv`, a new client table (538 rows, Id/Name/Desc,
decoded from the installed client's `babeltowerbuffdetails.tab`). Skill-title columns added and then removed
again after the owner clarified the note is the weakness, not the move list.

#### Endgame layout (wide board, log underneath)

`renderSection` marks `document.body.is-wide` for the endgame section; `player.css` then collapses
`.workspace` to a single full-width column so the log panel sits under the board instead of beside it (log
capped at 320px there). Scoped to Rank & weekly for review; extend to other sections only after the owner
approves the shape.

Note for future scans: bundle byte-scans read `D:\gemink` off an HDD and starve the game's loading and
Defender. Tell the owner first, cap the walk (hit bundle for the client bosssingle extras was
`resource/matrix/0d30ed78f6f24586.uab`, within the first ~6,800 files), and prefer reusing
`.runtime/*.tab` dumps already on disk.
- Owner-stated mechanics (ground truth): IB is Ultimate-only above 1.8M; one weekly boss, three
  element-weakness stages; the leaderboard counts the highest two stage scores (retail `RankStageNum 2`
  matches); clearing all three is not required.

### Deferred nonfatal bug: A-rank CUB display and tune mapping (root-caused, fixed in UI)

Owner report: a naturally A-rank CUB (Lingya, `Partner.Id 16070000`, `InitQuality 2`) already appeared as
S in the CUB section before any tuning, and Tune to level 30 / skill 5 / SSS produced SS in game.

Root cause, both symptoms from one line: `web-ui/player/player.js` carried `CUB_RANKS = ["S","SS","SSS","SSS+"]`
and indexed it by ladder position, but the client's own vocabulary (`xpartnerutil.lua:7`) is
**B/A/S/SS/SSS/SSS+ = Quality 1..6**, and Lingya's `PartnerQuality` ladder starts at 2 (A). So rung 1 (A)
displayed "S", and picking "SSS" (rung 4) sent `RankStep 4`, which the server correctly mapped to ladder[3]
= Quality 4 = SS. The server (`ApplyCubBulk` ladder mapping and the `Quality` clamp) was right all along;
`TuneCubStateEntry.Qualities` already carried each CUB's real ladder and the UI ignored it.

Fix (UI only, uncommitted): the card and the single Tune modal read `entry.qualities` and label each rung
by its real quality through the shared `CUB_RANK_LABELS` scale, so Lingya runs A/S/SS/SSS/SSS+ and SSS sends
step 4 = Quality 5. Bulk Tutti has no single ladder to index, so its Rank slider names the quality itself
(B..SSS+) and sends `Quality`; the server clamps it into each CUB's own range, and the tooltip says a CUB
whose ladder starts higher keeps its lowest rank. Verified against the live state endpoint: Lingya
`Qualities [2,3,4,5,6]`, current `Quality 5`.

Panel verification completed 20 Nov against the running app (served the fixed `player.js`): the
card shows SSS for Lingya (Quality 5), the Tune modal's Rank slider walks A/S/SS/SSS/SSS+ over
Lingya's five rungs with the note following each step, and the Tutti slider names the qualities
B..SSS+. A Tutti Perform of Level 30 / SSS / skill 5 on uid 2 posted `{Level: 30, Quality: 5,
SkillLevel: 5}` and applied 253 of 253 CUBs, every one inside its own ladder (the fetch-stub
payload capture ran in an isolated JS world and did not intercept, so that Perform was a real
write to the test account; the values match the owner's own test scenario). In-game read-back of
the tuned ranks is still the owner's call.

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