# Inventory & Ops Dashboard — Implementation Plan

> **For Hermes:** Use subagent-driven-development to execute task-by-task.

**Goal:** Import the proven control-centre features from Shittim (verify setup, backups, accounts, mail, updates) into the Selena-port desktop app first, and build the PGR character builder last, once those foundations exist.

**Execution order:** A (verify setup) -> B (backups) -> C (accounts) -> E (mail) -> F (updates apply) -> D (character builder, last).

**Architecture:** The Electron shell already supervises mongod + AscNet and proxies `/api` to the SDK port. New power arrives as fork commands using the `Command.Payload` channel, so the panel never touches the database. The builder is a new `Inventory` view; upgrades are driven by sliders, never by give-all.

**Tech stack:** Electron 33 (`desktop/main.js`), vanilla JS views (`desktop/ui/`), C# 8 (`AscNet.GameServer/Commands`), MongoDB through the server.

---

## Domain model — PGR, not Blue Archive

Read this before writing any code. There is no star/UE system here.

- **Rank** is the character's progression, separate from level. A freshly pulled S-rank construct sits at **S0** and is barely usable; shards push it S0→S1…→S10, then evolve to **SS**, **SSS**, **SSS+**. Shards come from the PPC (Phantom Pain Cage) shop, priced 50 per construct, which is exactly one rank step to SS0.
- **Memories** are the gear. A construct holds **8** in total but equips **6**; the remaining 2 come from **Harmony**, which only a 6-star signature weapon provides. A 5-star weapon leaves the build at 6 memories and permanently below optimal — which is why signature weapons matter.
- **Memory resonance**: each memory has **2** resonance slots. Slot 1 pools orb/basic-attack level and flat ATK/HP; slot 2 pools skill-level nodes (+1 Signature, +1 Core Passive, etc.). Slot 1 is effectively uniform across constructs; slot 2 depends on the construct's build.
- **Weapon resonance** is **class-specific** and must never be generalised: Tank and Breaker take Domain Deconstruction (def shred), Amplifier and Overlinker take Glorious Spear / Superconducting Axial Ray (ATK on healing a teammate), Attacker takes Glorious Afterglow (+30% ATK after a 3-ping; Breaker now also has access). Applying one node across a mixed roster writes nonsense onto classes that cannot use it.
- **Memory level** and **hypertune** are two different things and must stay two controls.
  A memory levels up to **45** (cost/limits in `EquipBreakThrough.tsv`: `LevelLimit`, `Exp`,
  `UseItemId`, `UseMoney`). **Hypertune is the final, conditional step**: it requires level 45
  *and* at least one resonance on that memory. A hypertuned memory turns each of its resonances
  into damage bonus, so a finished build (6 memories x 2 resonance) carries **12%**; the two
  Harmony memories cannot be resonated and therefore never contribute.

**Tables that back all of this (verified present):**
`share/character/quality/CharacterQuality.tsv` (374 rows: CharacterId → Quality tier),
`share/character/quality/CharacterQualityFragment.tsv` (12 rows: Quality, Type, DecomposeCount, ComposeCount, StarUseCount[1..8] — the shard ladder),
`share/equip/EquipResonance.tsv` (760 rows: AttribPool / CharacterSkillPool per resonance),
`share/equip/EquipResonanceUseItem.tsv`, `share/equip/EquipSuit.tsv` (118 rows: SkillEffect[1..6] + EquipIds[1..6]),
`share/equip/EquipSuitEffect.tsv`, `share/equip/EquipBreakThrough.tsv`, `share/equip/WeaponOverrun.tsv`.

---

## Current context (verified)

- `desktop/main.js` — settings, `/api/panel/*` catalogs, `/api/*` proxy, `startAll/stopAll/launchClient`, `settingsSnapshot()`.
- `web-ui/gm/console.js` — `character` section only sends `character add <id>`; give-all and Tutti exist for items.
- Server commands today: `bc, character, cleanup, coating, equip, help, item, level, save, scene, stage`.
- `CharacterData` (`AscNet.Common/MsgPack/Types.cs:3459-3471`): `Level, Exp, Quality, InitQuality, Star, SkillList, EnhanceSkillList, MagicList, FashionId, TrustExp`.
- Memory (awareness) progression lives in `AscNet.GameServer/Handlers/AwarenessModule.cs`, with
  level costs in `share/equip/EquipBreakThrough.tsv` and resonance catalogues in `EquipResonance.tsv`.
- Shittim reference: `ShittimControlCenter/src/js/pages/inventory.js` (590 lines) — the slider-driven builder this dashboard follows.

**Open questions to settle before Phase D (do not guess):** which field the client reads for rank (`Quality` vs a shard-owned rank value); whether Harmony slots are a weapon flag or a character field; how `EquipResonance.tsv` rows map to weapon vs memory nodes and to class.

---

## Phase A — Verify setup

### Task A1: `verifySetup()` in the supervisor
**Files:** `desktop/main.js`, `desktop/preload.js`
1. Return `{ checks: [{ id, ok, detail }] }` for: repo cloned, server built, mongod present, table present, game directory with `PGR.exe`, client patched (`gameDir/.ascnet-launcher/state.json`).
2. `ipcMain.handle('setup:verify', …)`; bridge in preload.

### Task A2: checks in the Config tab
**Files:** `desktop/ui/index.html`, `app.js`, `style.css`
1. Rows above the repository field; red rows name the button that fixes them.
2. Verify: remove mongod → red with "Install MongoDB"; start stack → green.

---

## Phase B — Backups

### Task B1: `backupNow(reason)`
**Files:** `desktop/main.js`
1. Copy `userData/mongo-data` and `Configs/` to `userData/backups/<timestamp>-<reason>/`; keep newest 5.
2. Call before `rebuildServer()` and before any update.
3. Verify: folder appears with `asc_net` files.

### Task B2: Backups controls
**Files:** `desktop/ui/index.html`, `app.js`
1. "Backup now" and "Open backups".

---

## Phase C — Accounts

### Task C1: `account` command
**Files:** create `AscNet.GameServer/Commands/AccountCommand.cs`
1. `account list|show <uid>|delete <uid>|reset <uid>`; `list` returns `{ ok, total, accounts:[{uid, username, playerPresent}] }`.
2. Refuse acting on the caller's own UID; `reset` clears Character/Inventory/Player but keeps the account.
3. Verify: `POST /api/AscNet/command/account {"args":["list"]}` returns both test accounts.

### Task C2: Accounts view
**Files:** `desktop/ui/accounts.html`, `accounts.js`, tab in `index.html`
1. Table + delete/reset with username-typed confirmation.
2. Verify: delete a throwaway; count drops.

---

## Phase E — Mail

### Task E1: `mail` command
**Files:** create `AscNet.GameServer/Commands/MailCommand.cs`
1. `mail send <uid|all> <subject…>` with a fixed attachment shape reusing `RewardHandler`.
2. Verify: send to UID 2, open the in-game mailbox.

### Task E2: Mail view
**Files:** `desktop/ui/mail.html`, `mail.js`
1. Recipient from `account list`, subject/body, item attachments, Send.

---

## Phase F — Updates

### Task F1: apply, not just show
**Files:** `desktop/main.js`
1. `applyUpdate()`: require repo cloned → `backupNow('update')` → `git pull --ff-only` → `rebuildServer()` → `stopAll/startAll`.
2. Report each step; abort with the reason on failure (no origin, dirty tree, build error).

### Task F2: Update tab
**Files:** `desktop/ui/index.html`, `app.js`
1. Local HEAD vs latest GitHub commit; "Update now" only when they differ.

---

## Phase D — Character builder (last: largest and most intricate)

> **Do this phase last.** Every other phase is an import of a proven Shittim feature; this one is new
> design with open questions that must be settled first (see Risks).

Slider-driven, per construct. No give-all anywhere in this phase.

### Task D1: read model
**Files:** create `AscNet.GameServer/Commands/CharacterInfoCommand.cs` (or extend `CharacterCommand`)
1. `character info <charId>` payload: `{ level, exp, quality/rank, skillList, memories:[{id, slot, level, hypertune, resonance:[slot1, slot2]}], weapon:{id, star, resonance}, harmony:{slots} }`.
2. Cross-check against the game profile of one account before building UI.

### Task D2: rank progression from shards
**Files:** modify `AscNet.GameServer/Commands/CharacterCommand.cs`; create `CharacterRankCommand.cs` if cleaner
1. `character rank <charId> <target>` where target is one step (S1..S10, SS, SSS, SSS+) or `next`.
2. Cost comes from `CharacterQualityFragment.StarUseCount[]`; consume the shard item, refuse when short, report the shortfall in the payload.
3. Add `character shards <charId> <count>` for granting the material itself (GM grant, explicitly a grant not an upgrade).
4. Verify: S0 → SS0 on the test account (the 50-shard PPC step), then confirm the in-game rank badge.

### Task D3: memory build panel
**Files:** `desktop/ui/inventory.*`
1. Six equip slots + two Harmony slots (Harmony disabled with a tooltip when the weapon is not 6-star).
2. Preset picker sourced from `EquipSuit.tsv` (the game's own recommended set) — a starting point, not a recommendation; the user adjusts afterwards.
3. **Memory level**: slider 1..45 per memory, cost from `EquipBreakThrough.tsv`. This is the only memory action allowed in bulk ("level all to 45").
4. **Memory resonance**: slot 1 and slot 2 pickers from `EquipResonance.tsv`, applied one memory at a time; no bulk resonance.
5. **Hypertune**: a separate control, disabled until that memory is level 45 *and* has at least one resonance. Show the resulting damage bonus (resonances on that memory) and the build total (6 memories x 2 = 12%, Harmony excluded) so the number is visible before and after.
6. Verify: a level-44 memory refuses hypertune; level 45 + 2 resonance accepts it and the total moves by 2%.

### Task D4: weapon and weapon resonance
**Files:** `desktop/ui/inventory.*`, `AscNet.GameServer/Commands/ResonanceCommand.cs`
1. Grant/equip a signature weapon (6-star) and show whether Harmony is unlocked as a result.
2. Weapon resonance nodes come from the catalog, filtered by the construct's class; a node that does not apply is refused with the reason (e.g. Glorious Afterglow offered to an Amplifier).
3. **Weapon resonance is never part of a bulk action** — the UI must not offer it in any "max all" flow.
4. Verify: Attacker accepts Glorious Afterglow; Amplifier is refused; Harmony adds two memory slots.

### Task D5: sliders, not forms
**Files:** `desktop/ui/inventory.js`
1. Level slider (1..cap), rank stepper showing shard cost per step, memory level slider per slot.
2. Each change posts one command and re-reads `info`; failures surface the server's own text.
3. Bulk = "level all memories to 45" only. Hypertune stays per memory (it is conditional on that
   memory's own resonance), resonance stays manual, and character level/rank have their own sliders.

---

## Files likely to change

`desktop/main.js`, `desktop/preload.js`, `desktop/ui/{index.html,app.js,style.css}`, new `desktop/ui/{inventory,accounts,mail}.*`,
`AscNet.GameServer/Commands/{AccountCommand,CharacterInfoCommand,CharacterRankCommand,ResonanceCommand,MailCommand}.cs`, `CharacterCommand.cs`, `docs/stage-b.md`.

## Validation

| Phase | Proof |
|---|---|
| A | Each check turns red when its target is removed |
| B | Backup folder holds mongo data; rebuild produces a snapshot |
| C | `account list` matches the view; delete removes a throwaway |
| E | Mail arrives in game |
| F | Pull + rebuild + restart leaves stack healthy and data intact |
| D | S0 → SS0 consumes the documented shard count and shows in game; Amplifier refuses an Attacker-only weapon resonance; Harmony unlocks 2 slots with a 6-star weapon; memory at 44 cannot be hypertuned, at 45 with 2 resonance the build total moves 2%; no bulk touches resonance or hypertune |


---

## Phase G — Dorm (player panel)

**Goal:** fill a dorm instead of hunting shop tabs one furniture piece at a time, from the panel
that already grants everything else.

What exists: `Player.Dorm` (`PlayerDormState`), the dorm shop tabs returned by
`GetShopBaseInfoRequest` from curated catalogs, the dormitory furniture tables, and
`GuildDormRoomService` for the guild dorm (separate, KCP closed).

### Task G1: `dorm info`
**Files:** new `AscNet.GameServer/Commands/DormCommand.cs`
1. Payload: every furniture template the account owns (count), every placed instance (room, slot,
   template), the current layout, and the templates the furniture table has but the account does
   not own.
2. Read-only. No DB write, no client push.

### Task G2: `dorm fill <room|all>`
**Files:** `DormCommand.cs`
1. Grant the blueprint/furniture item ids the tables name for the missing pieces, through
   `RewardHandler`/`Inventory` so caps and pushes behave like every other grant.
2. `all` fills every room; a room id fills that room. Unknown room ids are refused with the
   table's own ids listed.
3. Placement stays client-side: the panel grants ownership, the game places.

### Task G3: Dorm section in the player panel
**Files:** `web-ui/player/index.html`, `player.js`
1. A normal section (`fields` + `build`), so Perform and Tutti work without a custom renderer.
2. Tutti = `dorm fill all`.
3. Tooltip states that placement happens in game and that the section fills only what the table
   defines.

**Open questions (settle before writing G2):** which column holds the blueprint item id for a
furniture row; whether ownership needs the matching blueprint item at all; whether dorm furniture
is shop-only (then a fill would have to spend currency or be a labelled AscNet grant).

**Verify:** `--dorm-compat-only` on a fixture player (info lists the missing set, fill grants only
table ids, a second fill is a no-op); in game after the client is available.

## Phase H — Guild (player panel)

**Goal:** give a guild the resources and experience the game asks for, for the account the panel
acts as.

What exists: `GuildModule` (membership, ranks, donations, exp, funds), `GuildModule.Management`,
the guild level/exp tables, and `AccountModule` pushes for guild identity.

### Task H1: `guild info`
**Files:** new `AscNet.GameServer/Commands/GuildCommand.cs`
1. Payload: guild id/name/level/exp/funds, the acting player's rank and contribution, and the
   caps that apply (`GuildLevel` row).
2. Membership is read through `GuildModule`, never re-derived.

### Task H2: `guild grant <exp|fund|contribution> <n>`
**Files:** `GuildCommand.cs`
1. Go through `GuildModule`'s own mutation path so limits, receipts and pushes stay identical to
   what the game does; refuse a non-member (the module's own code) and report the code.
2. A GM action may exceed the daily donation limit only when the command says so explicitly
   (`confirm`), because the game's own path counts donations.
3. No new guild rows and no invented level curve: the cap comes from `GuildLevel`.

### Task H3: Guild section in the player panel
**Files:** `web-ui/player/index.html`, `player.js`
1. Normal section, Perform for one resource type, Tutti for all resource types the command
   accepts.

**Open questions:** which table caps exp per level and whether exp over the cap carries over;
whether contribution points are per member or per day; whether `GuildModule` exposes a path for
funds that does not also count a donation.

**Verify:** `--guild-grant-compat-only` (member vs non-member, cap refusal, push shape); in game
after the client is available.

## The acting-account channel (needed by D, G and H)

`POST /api/admin/command/{name}` takes `{ uid, args }` and runs the existing command layer for
that account: `AdminSession.Open(uid)` returns the live session when the player is in game, else a
socketless session over the same `Player`/`Character`/`Inventory` documents. The player panel
posts to `/api/panel/command/{name}` (the shell injects the token), so no sign-in exists on that
page and every section targets the account picked in "Acting as". The response carries
`live: false` when the change only exists in the database, and the panel says so in the log.

## Risks / open questions

1. **Rank field**: confirm whether rank lives in `Quality` or a shard-owned value before D2; a blind write desyncs the client badge.
2. **Shard cost source**: `StarUseCount[]` is the candidate; confirm it matches the 50-per-step PPC pricing in game.
3. **Resonance catalogue mapping**: `EquipResonance.tsv` must be split into weapon nodes (class-gated) and memory slot-1/slot-2 pools; this mapping needs one read-through before D4.
4. **Harmony**: confirm it is granted by the 6-star weapon flag rather than a separate inventory item.
5. **Two separate controls.** Memory level (to 45) and hypertune (level 45 + resonance) must never be
   collapsed into one button; hypertune is a consequence of a built memory, not a level step.
6. **No bulk resonance, ever** - memory or weapon. Bulk applies to character/memory level only.
7. **Damage bonus accounting**: confirm in `AwarenessModule.cs` that the hypertune bonus is derived
   per resonance (2 per memory, 12% for six) and that Harmony memories are excluded, before showing a
   total in the UI.
8. **Security**: commands are loopback-only and token-gated; the panel must never bind publicly.
