# Remaining work after the panel pass

Read first: `DESIGN.md` (direction), `.hermes/state.md` section 10 (PGR domain model) and
`skills/selena-port-domain`. Branch `selena-panel`, local commits only.

Each task below is independent. Do them in any order, one commit each, and verify before claiming
done. A fresh session must not restart work that is already verified: the tune flow, the resonance
lists, weapon rarity gating, dorm, guild, the Lit bundle and the custom controls are done.

## 1. Design details still open

Files: `web-ui/common/theme.css`, `web-ui/player/player.css`, `web-ui/gm/console.css`.

- Staff accent under the Performance panel header and an f-hole corner mark on framed boxes. One
  deliberate use per view, hairline only, never a background.
- A watermark of the iris or treble clef at the corner of the Performance panel, opacity 0.03 to
  0.05. It must sit behind content and must not add contrast noise.
- Equalizer bars beside the score preview: still while idle, moving briefly on input or on a
  successful Perform. Canvas or CSS keyframes, no library.
- Iris petals on a successful Perform: three to five shapes drifting and fading, once per action.
  Respect a reduced-motion preference and the existing mute control.
- Coatings and Scenes rail icons: a butterfly or opera mask for Coatings, a stage curtain or
  crescent for Scenes. Draw for the section, not from a stock set.
- Author credit line in the footer, next to the existing dedication line. Text is the owner's;
  ask before writing a name.
- Check every new rule against `DESIGN.md` and the contrast table: normal text 4.5:1, large 3:1.

Verify: computed styles in the running panel, screenshots at 1366 and 768, and the numbers for any
colour contrast claim. Do not report a contrast fix without the measured ratio.

## 2. Tune presets

Files: `web-ui/player/player.js` (modal), `AscNet.GameServer/TuneBuilder.cs` only if a preset needs
state the writer cannot express today.

- Presets are shortcuts over the same tune payload: F2P is SS0 with one weapon resonance, then SS3
  with two, SSS with three, and max is SSS+ with three plus a full build.
- The user has not decided the memory and weapon defaults per preset yet. Ask, then store the
  presets as data, not as branches in code.
- A preset must never write directly; it fills the modal, and Perform stays the only write.

Verify: apply a preset in the panel, Perform, read the character back through
`/api/panel/command/character` and compare with the preset's intent.

## 3. Harmony confirmation

`WeaponOverrunData.ChoseSuit` is a set id and an active harmony counts as two pieces. Whether the
effect needs the overrun level raised first is still unknown. The owner said they will test end to
end and report. Do not change the writer until that answer arrives.

## 4. Weapon catalog edge cases

- A construct whose frames share `EquipType` sees every weapon of that type (all three Lee frames
  share 1). Confirm with the owner whether that is what the client shows.
- `WeaponOverrun` has rows only for some weapons, so `ChoseSuit` can be set while the overrun level
  stays 0. Revisit once the harmony question in task 3 is answered.

## 5. Panel surfaces still using a factory instead of the element

`sel-select`, `sel-toggle` and `sel-slider` exist in `web-ui/common/components/index.js`, are
bundled to `web-ui/common/components.js`, and the account pickers plus the mail recipient use them.
The remaining selects inside the forms still call `SelenaUI.select` directly through
`fieldControl` in both panels. Move them one surface at a time, keep the factory path as the
fallback, and reload the frames only.

**Done.** `SelenaUI.picker` in `ui.js` returns the element when the bundle is on the page and the
factory otherwise, with one handle for both, and every call site goes through it: the `select`
branch of `fieldControl` in both panels, the six pickers inside the tune modal, and the two
acting-account pickers. The fallback is proven by loading a page with `components.js` blocked. The
element now takes its tip as a `tip` property and hands it to its inner button, so the tip does not
answer from the host box or hang over the open list.

## 6. Testing owed

- Dorm and guild Perform from the panel, against uid 2, then read the account back. The commands
  are covered by `--dorm-builder-only` and `--guild-builder-only`, but the panel path is not.
- Tune with a full six memory build and a 6 star weapon, then log in with the game client and
  confirm the build shows and no disconnect loop follows.
- The shell account list can only be exercised in the real Electron window, because it needs the
  preload bridge. A browser tab cannot load it.

## Traps that cost time before

- The running `AscNet.exe` executes the code it was started with. Stop the stack, build, start
  again, then verify; otherwise a fixed write measures the old behaviour.
- `AscNet.exe` and stray `.NET Host` processes lock `AscNet/bin`. Kill them before
  `dotnet build AscNet/AscNet.csproj` or the build fails on copy.
- Editing markup by slicing text can leave a stray closing tag; count `<div>` against `</div>` and
  `<section>` against `</section>` after any structural edit.
- Health probes must not open a TCP connection to the game port; read the process or cache the port.
- The browser harness leaves `bu-<session>.port` files behind when its daemon dies, which fails the
  next call with `Access denied`. Remove them and open a new session name.
- The Electron app holds one instance. A second launch focuses the first and exits; its startup
  code is skipped so it cannot race the port.
