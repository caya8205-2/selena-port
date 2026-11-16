# Selena-port design direction

The interface is a control terminal that belongs to Selena, not an admin panel. Every visual
decision comes from her three frames (Tempest, Capriccio, Pianissimo): classical music, gothic
opera and theatre, and an elegant melancholy. Anything that reads as a generic dashboard is wrong,
even when it is convenient.

This file is the source of direction for every surface in the repo: the desktop shell, the GM
console, the player console, and any new panel. `web-ui/common/theme.css` implements it as tokens;
when a token and this file disagree, this file wins and the token is fixed.

## Identity

- Selena is a musician and playwright of the World Government Association of Art, and her kit is
  written as performance: a cello-blade, a flute-sword, a bowstring rapier, a serenade of
  butterflies.
- The tone is a quiet theatre before the curtain rises: dark, precise, faintly ornate. Never loud,
  never playful, never "tech startup".
- Read each surface as a score. The user is a conductor issuing a cue, not an operator filling a
  form.

## Palette

| Role | Value | Where it comes from |
|---|---|---|
| Background base | `#0d0f18` / `#111420` | her long black hair, the night of Tempest and Capriccio |
| Raised surfaces | `#161a29` / `#1d2233` | instrument bodies, stage depth |
| Primary accent | `#5c6bc0` / `#6a7fdb` | her eyes, the indigo of Piano's effects |
| Secondary accent | `#4fc3f7` | cerulean of the crystalline stage light (used sparingly) |
| Highlight metal | `#d4af37` champagne gold, `#e2e8f0` pale silver | opera costume trim, her hair ornament, the rapier |
| Text | `#e9ecf5`, `#a3aac0`, `#6f7793` | paper, ink, dust |

Rules: indigo is the only colour that means action. Gold marks a frame or an accent, never a
button fill. Cerulean is for a live signal. Borders are hairlines, not blocks. A second accent
colour on one surface is already one too many.

## Motifs and iconography

- Five-line staff. The brand mark. One deliberate use per view, as a divider under the page title
  or a barline beside a section marker. It must never become a background.
- Treble clef, repeat sign, note heads: status and continuation, not decoration on every control.
- Iris flower and crystal petals. Her most iconic symbol, the shape for the product mark in the
  corner. Sharp, symmetrical petals, not a generic flower glyph.
- Butterflies and swan feathers. Appearance and ephemeral effects.
- Instruments: the f-hole of a cello can serve as a corner accent on a framed box; the flute-sword
  and bowstring rapier inform the thin, elongated proportions of hit areas and rules.
- Icons that carry a section stay drawn for that section: a broom cleans, a person is a construct,
  a costume thread is a coating. Never a generic icon set.

## Typography

- Serif with classical bearing for titles and section names: Cinzel, falling back to Playfair
  Display or EB Garamond. Titles are set in small caps or uppercase with generous tracking.
- Clean monospace for anything the machine says: command preview, console log, ids, levels.
  JetBrains Mono, falling back to Cascadia Mono or Consolas.
- Body text stays a quiet sans. No display serif in body copy, no monospace in prose.

## Microcopy

The panel speaks in the language of a performance. Player-facing words are the game's words, and
the furniture around them is theatrical.

| Plain term | What this interface says |
|---|---|
| Execute | Perform, Play, Crescendo |
| Clear console | Rest, Mute, Silence |
| Command preview | Sheet music, Score preview |
| Presets, scenes | Acts, Movements, Aria |
| Progress of the log | Opus 01, Movement I |

Empty states carry her voice, addressed to the Commandant, in English, without em dashes:
"The stage is quiet, Commandant. Write the first note of our duet."

Every control carries a tooltip that explains itself in the same voice; the help text is never
technical jargon.

## Geometry

- Sharp corners: 2px to 4px. Rounded pills read casual and are wrong here.
- Double hairline borders, the way an opera ticket or a score cover is framed: an outer rule, a
  whisper of space, an inner rule.
- Proportions run long and thin, like a bow across strings: tall rows, narrow gutters, generous
  vertical rhythm.
- Elevation is a rule and a slight tonal step, not a floating shadow. Shadows appear on overlays
  only, because an overlay genuinely sits above the page.

## Motion and sound

- Motion is restrained and legible: a fade, a small translate, a pulse on a live indicator.
- Sound is part of the interface and stays quiet: a pizzicato when moving between sections, a
  short chord on a successful command, a low note when the log is silenced. A mute control always
  exists and remembers its state.
- Celebration is allowed once per action at most: a few iris petals or butterflies drifting and
  fading on a successful Perform. Never confetti everywhere.

## What already exists

Implemented in `web-ui/common/theme.css`, `web-ui/player/**` and `web-ui/gm/**`:

- Midnight navy surfaces with periwinkle indigo as the action colour and champagne gold for frames
  and active markers.
- Cinzel titles, JetBrains Mono for the score preview and the log.
- Selena portrait where the initials used to be, five-line staff under the page title, barline
  beside the active section marker.
- Microcopy: Score, Score preview, Performance, Perform, Silence, Opus numbering in the log.
- Sound cues with a mute button, thin indigo scrollbars.

## Open suggestions, not yet applied

- Perform button text in pale gold (`#f3e5ab`) or near white (`#f8fafc`) instead of dimmed text.
- A staff-line accent under the header of the Performance panel, and an f-hole corner mark on
  framed boxes.
- A low-opacity iris or clef watermark in the corner of the Performance panel.
- A theatre spotlight gradient on rail hover instead of a flat block change.
- The amber warning banner recoloured to deep indigo with champagne gold text so it belongs to the
  palette.
- `::selection` in translucent periwinkle with pale gold text.
- Equalizer bars beside the score preview that move while the input is being written.
- Lore quotes in empty panels, chosen per panel rather than one repeated line.