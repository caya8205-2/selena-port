# Construct Tutti, bulk leveling and log controls

**Goal:** make granting in the player panel read the way a player thinks, add a stripped bulk-leveling path for
constructs, and give every log a clear button.

**Architecture:** the panel keeps one shared action row per section (Tutti, Perform, Silence) and one tune modal.
Tutti stops being a two-press arm everywhere and becomes its own small modal that states what it does, carries the
amount where the section takes one, and offers Perform or Cancel, so a bulk command is always a deliberate press.
The Construct tab gets a second, stripped tune modal that writes level, rank, promotion and skills for every owned
construct in one bulk call, leaving memories, weapons and harmony alone.

**Tech stack:** vanilla JS panels (`web-ui/`), Lit pickers already in place (`SelenaUI.picker`), the Electron shell
(`desktop/`) for the .NET panel and the accounts/config/update logs, the existing `POST /api/panel/tune` proxy, and a
new `POST /api/admin/tune-bulk` action in `AscNet.SDKServer` that reuses `AscNet.GameServer/TuneBuilder.cs`.

**Standing rules (not decisions):** every new UI string, code comment, identifier and commit message is English.
No em dashes. Every control reuses the panel's own primitives, never a native select, checkbox or range.

**Execution order:** note and copy first (no behaviour), then the shell log buttons, then the Max button, then the
Tutti modal and the weapons amount, then the bulk-level endpoint and its modal (the largest), then the tooltip sweep,
then verification and docs. The validation table below follows the same order.

---

## Current context (verified in the source, 11-17)

- The player panel action row is built once per section render: `web-ui/player/player.js:760-785`. It hides
  `#allBtn` unless the section declares `allArgs`, and the button's tip reads "Press twice to confirm".
- Tutti arms on the first press and fires on the second inside five seconds: `player.js:1611` onward, with the
  arming state reset on every section render.
- The section tables carry `allArgs` for items (`player.js:29`), characters (`:36`), weapons (`:43`), memories
  (`:74`), coatings (`:84`), scenes (`:91`), stages (`:104`) and dorm (`:129`).
- The Construct tab is the `characters` section (`player.js:1060` area) with a `Tune` and a `Max` button; `Max`
  writes a complete build through the same tune payload.
- The tune modal sections are built in `openTune` (`player.js:~1195-1490`): progression (level, rank, promotion,
  skills), memory slots, memory level, memory resonance, weapon, harmony.
- Rank steps for the tune slider are generated from the base quality upward in `rankSteps()` (`player.js:1124-1132`),
  one step per star of each quality, so a B-rank construct walks B0..B10, A0..A10 and only then S0.
- The player panel console already has a clear button: `web-ui/player/index.html:129` (`#clearBtn`, label `Silence`).
- The Electron shell has four logs with no clear control: `#accountsLog` (`desktop/ui/index.html:82`), `#mailLog`
  (`:141`), `#configLog` (`:192`), `#updateLog` (`:221`).
- The tune endpoint is per character (`TuneBuilder.Apply` takes one `CharacterId`); an empty `Memories` list leaves
  stored memories alone (`TuneBuilder.cs`, the `if (request.Memories.Count > 0)` guard), so a level-only call is safe.
- Awaken rule established on 11-17, from the client itself: a stat pick on the upper resonance never counts toward
  `Equip 6★ Resonance Skills x12` or `Equip Hypertuned Resonance Skill x12`; a skill pick on both slots of all six
  memories does. Tuning with stat uppers therefore cannot awaken a construct.

## Phase 1: the awaken note

**Task 1.1** Add a visible note to the tune modal's Memory resonance section.

- File: `web-ui/player/player.js`, the `section("Memory resonance", ...)` call and its body.
- Copy, English, no em dash: `A stat pick never counts toward an awaken. To awaken from a tune, set the upper
  resonance to a skill, or leave the upper slot empty and add it in game afterwards; the lower slot can stay as the
  tune wrote it.`
- Keep it inside the section, not as a modal banner, so it sits where the choice is made.

**Task 1.2** Record the same rule in the repo notes.

- File: `.hermes/state.md`, section 10 "Memory resonance", next to the measured paragraph already there.
- One sentence, no new headings.

## Phase 2: clear buttons on the shell logs

**Task 2.1** Add a `Silence` button to each of the four shell logs.

- File: `desktop/ui/index.html`, one button per log block (`#accountsLog`, `#mailLog`, `#configLog`, `#updateLog`),
  class `btn btn--quiet`, matching the player panel's `#clearBtn`.
- File: `desktop/ui/app.js`, one delegated handler bound once (not inside a render function), clearing the target
  log's text and keeping the panel's own log line untouched.
- Layout: the button sits in the log block's own header row, not floating over the list. No sticky positioning.

**Task 2.2** Confirm the player panel's other log-bearing sections.

- Read each section's `build`/`custom` renderer in `player.js`; if a section appends to a log element without a clear
  control, add the same `Silence` button beside it. Report the list found, do not invent sections.

## Phase 3: remove Max from Construct

**Task 3.1** Delete the `Max` button from the Construct card.

- File: `web-ui/player/player.js`, the `paintCard()` action row (the `button("Max", ...)` call next to `Tune`).
- Keep `performMax` only if something else calls it; if nothing does, delete the function and its helper
  (`WEAPON_LEVEL_CAP` usage stays if the tune modal still needs it).

## Phase 4: Tutti becomes a modal, not an arm

**Task 4.1** Replace the two-press arm with a modal open.

- File: `web-ui/player/player.js:760-785` (tip and label) and `:1611` onward (the arm/fire state).
- Clicking Tutti opens `#tuttiModal`; the arming timer, the `is-armed` class and the five second window are removed.
- The button keeps its disabled rule: hidden when the section has no `allArgs`, disabled when the section cannot run
  at all.

**Task 4.2** Build the Tutti modal.

- New markup in `web-ui/player/index.html`, styled in `web-ui/player/player.css` with the existing modal primitives
  (`#tuneModal` is the reference), closable with Escape and the Cancel button.
- Every section with `allArgs` uses it, so the arm-twice path is gone everywhere.
- Content is the section's own title, one plain sentence saying Tutti applies this tab to every entry at once, then
  the section's bulk inputs and the two buttons.
- Bulk inputs exist only where the command takes a count: Items, Memories, and Weapons once task 4.3 adds its amount.
  Characters, Coatings, Scenes, Stages, Dorm and Guild take no count, so their modal is the explanation and the
  buttons: a confirmation step, not a form.
- Perform runs the section's `allArgs(values)` with those values and reports through the existing log, one line per
  command like the current Tutti does.

**Task 4.3** Give Weapons its own amount.

- File: `web-ui/player/player.js`, the weapons section table: add the same `amount` field the items and memories
  sections use (`{ key: "qty", type: "number", label: "Amount", value: "1", min: 1, ... }`) and use it in `build`
  and `allArgs` (`["add", v.weapon.id, v.qty]` and `["add", "all", v.qty || "max"]`).
- Same change in `web-ui/gm/console.js`, whose section table is a separate copy.

**Task 4.4** Make the relationship between Perform and Tutti explicit in the copy.

- The section form keeps its own fields and its own Perform. The Tutti modal states its own amount so a user who
  never touches the form's Amount still gets the bulk amount they asked for.
- Tooltip on the Tutti button: `Tutti: apply this tab to every entry at once. Opens a short form with its own amount.`

## Phase 5: stripped bulk leveling in Construct

> Open questions 1 and 2 must be answered before this phase is implemented; tasks below describe the confirmed parts.

**Task 5.1** Add the Tutti button to the Construct tab next to Silence.

- File: `web-ui/player/player.js`, the Construct card's action row: `Tune` keeps its place, `Tutti` is added beside
  the shared row's `Silence` as the owner asked.

**Task 5.2** Build the stripped modal.

- New markup: `#bulkModal` in `web-ui/player/index.html`, styled like `#tuneModal`.
- Controls kept: `Level`, `Rank`, `Promotion` and `Skills`. Skills and promotion are not character specific:
  every construct has them with the same ceiling, so they belong in a bulk pass. What the modal drops is the gear
  that differs per construct: memory slots, memory level, memory resonance, hypertune, weapon, weapon level, weapon
  resonance and harmony.
- `Rank` is a bound, not the point of the modal: its first stop is `as is`, which leaves every construct's rank
  untouched, and the stops above it exist so a bulk pass can raise rank in one move without the B1..B10 and A0..A10
  walk.
- Rank slider stops: a first stop `as is` meaning "do not touch the rank", then `S0, S1 ... S10, SS0 ... SSSSS+`
  built straight from quality 3 upward, so a B or A construct jumps base to S0 in one stop (`rankSteps()` gets a
  `fromS` flag rather than a second implementation).
- Copy: `Bulk level: sets the level, and the rank if you move it, for every construct in this account. Memories,
  weapons and harmony stay as they are.`

**Task 5.3** Write it through a bulk endpoint, not a loop of tune calls.

- New action in the admin channel: `POST /api/admin/tune-bulk` in `AscNet.SDKServer/Controllers/AdminController.cs`,
  reusing `TuneBuilder` rather than duplicating its write path.
- Request: `{ Uid, Level, Quality, Star, Grade, SkillLevel }` where every field may be null. Null means "keep what
  the construct already has", which is how the modal's `as is` rank and an untouched promotion are expressed without
  sending 86 different payloads.
- The action walks the account's owned constructs and calls the existing per-construct apply with a Character block
  built from each character's own values (`Level = request.Level ?? character.Level`, and the same for Quality, Star
  and Grade), `Memories` empty, no `Weapon`, `MemoryLevel` 0, `Hypertune` null and `SkillLevel = request.SkillLevel
  ?? 0`. Building the block per character keeps the documented trap out of reach: a request without a Character block
  clamps a construct to level 1 and its base rank.
- Response: `{ total, applied, failed: [{ characterId, name, error }] }`. One failing construct does not stop the run.
- The shell proxies it as `/api/panel/tune-bulk` in `desktop/main.js`, next to the existing `/api/panel/tune` proxy,
  and the modal reports the summary plus one line per failure in the log.

**Task 5.4** Verify on one account.

- Run it on uid 2 with the rank slider at `as is` and level 80; then read back three constructs through
  `character info` and confirm level rose, rank unchanged, memories and weapons untouched.

## Phase 6: remove tooltip slop

**Task 6.1** Narrow the rule in the design document.

- File: `DESIGN.md:74`, which currently says "Every control carries a tooltip that explains itself in the same
  voice; the help text is never technical jargon." That sentence produced a tip on nearly every control, including
  the ones whose explanation is already on screen.
- Replacement: a tip exists for a control whose *name* comes from the performance vocabulary (Perform, Silence,
  Tutti, Opus, Score preview) and for a control whose effect is invisible until it runs. A tip never repeats a
  section note, a field hint, a placeholder, or an empty state that already says the same sentence.

**Task 6.2** Sweep the tips that duplicate visible copy.

- Files: `web-ui/player/player.js`, `web-ui/gm/console.js`, `web-ui/common/ui.js`, `desktop/ui/app.js`,
  `desktop/ui/index.html`.
- Method: list every `data-tip` attribute and every `tip:` string with the element it sits on, then remove the ones
  whose text restates inline copy. The Dorm tab is the worked example: `OPERATION` already carries the hint
  "filling grants every piece the tables name that the account does not own", and the same sentence is repeated as
  its tooltip.
- Keep Perform, Silence, Tutti, the score and opus labels, the acting-account label, and anything whose behaviour is
  not visible before the press. Those are the tips the owner asked for in the first place.
- Report the removals as a list per file and re-check every remaining tip against the rule from 6.1.

## Files likely to change

- `web-ui/player/player.js` (sections, action row, tune modal note, bulk modal, arm removal, tips)
- `web-ui/player/index.html` (Tutti modal, bulk modal, any new Silence buttons in the panel)
- `web-ui/player/player.css` (modal layout for the two new modals)
- `web-ui/gm/console.js` (weapons amount field, tips)
- `desktop/ui/index.html` (four Silence buttons, tips)
- `desktop/ui/app.js` (the clear handler)
- `desktop/main.js` (the `/api/panel/tune-bulk` proxy)
- `AscNet.SDKServer/Controllers/AdminController.cs` (`tune-bulk` action)
- `AscNet.GameServer/TuneBuilder.cs` (the entry point the bulk action reuses)
- `DESIGN.md` (the narrowed tooltip rule)
- `.hermes/state.md` (the awaken rule note, the panel tip rule)

## Validation

| Phase | How it is proven |
|---|---|
| 1 | Tune modal opened on a construct: the note is readable in the Memory resonance section; state.md carries the sentence |
| 2 | Each of the four shell logs fills, the button empties it, and the button is reachable by keyboard |
| 3 | Construct card shows Tune and Tutti only; `grep -c 'Max' web-ui/player/player.js` shows no button call left |
| 4 | One click on Tutti opens the modal in every section that declares `allArgs`; where the command takes a count the field is present and Perform uses it, where it does not the modal is the explanation and the two buttons; Escape and Cancel close it; no arm state anywhere |
| 5 | `POST /api/admin/tune-bulk` on uid 2 with `Level` 80 and every other field null: the report says total equals the owned count, applied equals total, zero failed; three constructs read back with level 80 while rank, promotion, skills, memories and weapon are unchanged. Then the same call with `Quality` 3 and `Star` 0: a B-rank construct reads S0, not B10 |
| 6 | `data-tip` inventory before and after: removals listed per file; every remaining tip is either a performance-vocabulary name or a control whose effect is invisible before the press; the Dorm `OPERATION` tip is gone while its inline hint stays |

## Risks and open questions

- None outstanding. Every UI string, code comment and commit message is English, always, per the standing
  convention; it is not a question to ask again.