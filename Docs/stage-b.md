# Stage B - features the command layer does not cover yet

Stage A shipped the panel on top of the existing AscNet chat commands
(`item`, `character`, `equip`, `coating`, `scene`, `level`, `stage`, `bc`,
`save`). Everything the GM and player pages do today is one of those commands.

Stage B adds the features that have **no command behind them**. They all need
server-side handlers in `AscNet.GameServer`, which is upstream code; this fork
now owns those additions and they must follow upstream's command pattern so the
panel keeps a single interface (`POST /api/AscNet/command/{name}`).

## Why these three

The Android repack's player panel had them, and they are the reason people open a
panel instead of the in-game menu: cleaning a full inventory, filling a dorm
blueprint gap, and moving guild resources. Leaving the cards in the UI without a
backend would be a dead control, so they are labelled *stage B* until they exist.

## B1 - Inventory cleanup  (implemented)

```
cleanup preview <weapons|memories> <maxStar 1..6> [includeDeveloped 0|1]
cleanup apply   <same args> confirm=<token>
```

Implemented in `AscNet.GameServer/Commands/CleanupCommand.cs`, with the panel
flow in the player page (Maintenance -> Cleanup).

What changed against the first draft, and why:

- **Weapons and memories only.** An inventory item (`session.inventory.Items`)
  has no in-use signal at all, so a bulk delete there could reach a currency or a
  quest ticket. Partners keep their star on the instance, not on a template
  column, so "up to N stars" has no honest meaning for them. Both categories are
  refused by the argument regex rather than failing later.
- **Star range is 1..6.** The Equip table has Star 1 and 2 entries; a 3..6 bound
  would have left those in the bag forever.
- **Eligibility is the game's own decompose gate**: not equipped
  (`CharacterId == 0`), not locked, not recycling, not in a team preset, not in a
  chip group, no confirmed or unconfirmed resonance, no pending resonance. With
  `includeDeveloped=0` it also requires level/exp/breakthrough/awaken/overrun to
  be untouched.
- **The token is derived, not stored**: a hash over the sorted candidate ids,
  the player id and the settings. A restart cannot invalidate a preview the user
  is looking at, and a changed set invalidates it by itself.
- **Apply runs under `Session.GetPlayerOperationLock`**, recomputes the candidate
  set, and refuses when the token no longer matches, so the confirmed set is the
  set that was shown. Deletions go through `NotifyEquipDataList.DeletedEquipIdList`
  and `SaveChecked()`, because a removal without the push leaves stale rows in the
  client until relog.

### Command payload channel

`Command.Execute()` returns `void` and the SDK route answered a literal
`{ msg: "OK" }`, so no command could return counts. The fork now adds
`Command.Payload` (virtual, null by default) and the controller answers
`{ msg, data }`. Commands that only have something to say are unaffected.

## B2 - Guild resources  (medium risk)

```
guild shopcoin   <1..10000>
guild personal   <1..10000>
guild exp        <1..10000>
guild talent     <1..10000>
guild levelup
```

- permission split: pool resources and level-up require Commander or Vice
  Commander; members may only top up their own Joint Points
- one shared 10s cooldown per account, like the CN panel documented
- honest errors: "not in a guild", "guest cannot top up", "cooldown 7s"

Panel side: the guild card returns, with the permission matrix shown as disabled
options rather than hidden ones, so the reason is visible.

## B2b - Per-coating unlock  (implemented)

`coating unlock <characterId>` takes an optional third argument,
`coating unlock <characterId> <coatingId>`, validated against
`FashionTable.CharacterId` (the coating must belong to that construct) and
`Character.IsOwnableCharacter`. Granting a coating onto a construct the account
does not own is invisible in the game, so it is refused rather than written.

The panel reads coatings from `share/fashion/Fashion.tsv` through
`/api/panel/coatings/{characterId}` (Id, Name, Quality tier), and the GM Coatings
section is a two-step gallery: construct, then its coatings. "Unlock every
coating" for that construct stays one press. The player page still unlocks the
whole wardrobe for one construct; mirroring the two-step there is the next step.

## B3 - Dorm blueprint shortfall  (highest risk, spike first)

```
dorm blueprints quote <roomId> <templateId>
dorm blueprints buy   <roomId> <templateId> confirm=<quote token>
```

- deduct finished furniture already in the room and in the bag, then price the
  missing blueprints in furniture coins only (never rainbow/black cards)
- refuse the whole order when any blueprint is unbuyable or the balance is short
- requires the dorm/furniture tables; coverage is unknown, so this starts with a
  spike that reads the tables and reports what is missing before any UI work

## B0 - Online status probe  (no upstream change)  [implemented]

The panel cannot see AscNet's live sessions from a separate process, and there is
no status endpoint today. A cheap, honest probe:

```
POST /api/AscNet/command/save      (token of the signed-in account)
  200            -> account is in game (a session exists)
  400 "Player is offline!" -> account exists but the game is not running
```

`save` is idempotent for the owner's own data. If that is not acceptable, the
alternative is a read-only endpoint in `AscNet.SDKServer` that reports whether a
session exists for the token's player - small, but it does touch upstream.

## Order of work

1. B0 probe (no upstream edit) - makes the panel's status truthful immediately
2. B1 cleanup - the feature people actually miss
3. B2 guild - adds permissions and a cooldown, all local to one session
4. B3 dorm - only after a table-coverage spike

## Verification for each step

- the new command appears in `GET /api/AscNet/commands` with its help text and
  argument regexes, so the panel picks it up with no code change
- preview is side-effect free and repeatable
- apply is idempotent under the confirmation token
- the panel shows the server's own error text, never a guessed one
- `tools/dev/mock_sdk.py` gains the route for UI work before the real handler
  exists, so design can ship ahead of the server