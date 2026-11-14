# Selena-port

A fork of **InfiniteLoop** that adds a **browser self-service panel** to the PGR
private server, so granting items, checking a save and cleaning an inventory no
longer requires the in-game GM menu or chat commands.

Named after Selena. The project exists because a friend wanted their progress on
a screen bigger than a phone, without an emulator in the middle.

> Not an official service. Fan project, local only, no other players unless you
> share your server.

## What upstream already does (and we do not redo)

| Piece | Notes |
|---|---|
| `AscNet.Launcher` | Rust + Slint launcher: SELECT GAME, ADOPT a Steam or Kuro-launcher install, SETUP, PLAY, VERIFY & REPAIR, CLIENT MODS |
| `proxy.py` | mitmproxy addon: rewrites `ServerListStr` / gate URLs to the local server, passes telemetry hosts through |
| `AscNet` server | game TCP `2335`, SDK/HTTP `8080`, MongoDB `27017` started and stopped by the launcher |
| GM access | in-game GM menu (Ctrl+Shift+D, via client mods) and `/help` chat commands |
| Regions | EN, TW, KR, JP, CN from one instance (`Resources/Configs/version_config.json`) |

Client support for the **official Kuro launcher** install (not only Steam) is
verified against `AscNet.Launcher/supported-client.json`: the SHA-256 of
`PGR.exe`, `GameAssembly.dll`, `PGRBase.dll`, `UnityPlayer.dll`, `KRSDK.dll` and
`libkrsdkcurl.dll` from a 4.9.1 launcher install all match the allowlist.

## What this fork adds

1. **Web panel** (`web-ui/`, English) - GM console and player self-service in a
   browser: grant items/characters/equipment/coatings/scene backgrounds, set
   level, clear stages, guild resources, dorm blueprint fill, inventory cleanup.
2. **Two upstream-panel bug fixes** carried over from our Android-side work:
   the player panel referenced `/gm/panel.css` and `/gm/panel.js` (both 404),
   so it rendered unstyled and ran no JavaScript.
3. **Android port reference** (`docs/apk-port/`, `tools/apk-port/`) - the
   internals we reverse engineered from the community Android repack: the
   `XABA`/`XALZ` assembly store, `PgrPhoneHost`'s HTTP surface, and the
   translation pipeline used for the panel.

The web panel is frontend-complete. The backend that will serve it
(`AscNet.WebPanel`, calling into `AscNet.SDKServer`/`CommandController`) is next.

## Status

- [x] Identify client/version compatibility (4.9.1, official launcher, EN)
- [x] Panel UI translated to English, asset paths fixed, EN layout verified
- [x] Android internals documented for reference
- [ ] `AscNet.WebPanel` project: `/gm`, `/player`, `/api/player/*`
- [ ] Wire panel actions to the server's command layer
- [ ] End-to-end run: launcher -> client -> panel in browser

## How to run (upstream flow)

Follow the upstream [README](README.md): download `AscNetLauncher.zip` from the
InfiniteLoop releases, SELECT GAME, ADOPT your existing install, SETUP, PLAY.
Use a **local account** created at the login screen; never real Kuro credentials.

## Licensing

Mixed, and deliberately documented: see [LICENSE.md](LICENSE.md) and
[NOTICE.md](NOTICE.md). Short version - upstream server code carries no license
and is not relicensed here, `AscNet.Launcher` is GPL-3.0, and this fork's own
web panel and tooling are MIT.