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

## B1 - Inventory cleanup  (highest value, lowest risk)

Self-contained, single account, no cross-player state.

```
cleanup preview <memories|weapons|partners|items> <maxStar 3..6> [itemId] [includeDeveloped 0|1]
cleanup apply   <same arguments as preview> confirm=<token from preview>
```

Rules to implement, mirroring the CN panel's semantics:

- keep anything equipped, locked, referenced by a team preset, or part of a
  Memory set; keep invested items unless `includeDeveloped=1`
- items are deleted outright, no material refund
- `preview` returns `{ eligible, items, quantity, sample }`; `apply` requires the
  preview token so the confirmed set is the one that was shown
- reject while the player is offline (existing session check already does this)

Panel side: Preview -> review -> typed confirmation ("CONFIRM CLEANUP") ->
Perform. No new HTTP endpoint; the existing command route carries it.

**Open questions:** does the inventory model expose a stable "invested/leveled"
flag per item, and is the team-preset reference list reachable from the session
object? Both need a read pass over `AscNet.GameServer/Handlers` before coding.

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

## B0 - Online status probe  (no upstream change)

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