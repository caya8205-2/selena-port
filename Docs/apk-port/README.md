# Selena-port

A **fork of [InfiniteLoop](https://github.com/reiserFSs/InfiniteLoop)** (itself a
branch of [AscNet](https://github.com/rafi1212122/AscNet)) that runs a
**Punishing: Gray Raven 4.9.1 private server natively on Windows** against the
**official Kuro-launcher PC client**, plus a browser self-service panel for the
server.

Named after Selena, because every project deserves a construct.

> Status: research. Upstream InfiniteLoop already ships the launcher, the
> mitmproxy redirect and the in-game GM menu. What this fork adds is the piece
> upstream does not have: a **web panel** (GM console + player self-service)
> and its English UI. See [Roadmap](#roadmap).

---

## What this is

Upstream, the project is a single Android APK that wraps three things:

| Component | What it is | Where it lives upstream |
|---|---|---|
| `AscNet` server | ASP.NET Core (`net8.0`) game server, Kestrel, SQLite via SqlSugar | `lib/x86_64/libassembly-store.so` (Mono assembly store) |
| `PgrPhoneHost` | reverse proxy + static host for the GM/player web panel | same assembly store |
| Web panel | GM console and player self-service UI (HTML/CSS/JS) | `assets/server-resources/Web/` |

The game itself connects to the server locally; the Android wrapper exists only
to host the server and to seed the client's config. This repository keeps the
server and the panel but moves them out of Android and onto Windows.

## What this repository adds

Everything below is this fork's own work, not upstream's:

- **Windows-native server host** - extract the 373 assemblies from the Xamarin
  `XABA`/`XALZ` store, restore their real identities, generate
  `AscNet.runtimeconfig.json`, swap the Android SQLite binding for the Windows
  `e_sqlite3` native, and lay out the directory tree the server expects.
- **Full EN translation of the web panel** - 255 user-facing strings plus 27
  source comments, done with a segment-aware rewriter instead of blind string
  replacement, with the CN originals preserved as `.zh-orig` beside each file.
- **Two real bug fixes in the panel** - `player/index.html` referenced
  `/gm/panel.css` and `/gm/panel.js`, both of which 404 (the files live under
  `/player/`), so the player panel rendered as unstyled HTML *and* ran no
  JavaScript. Also fixed the EN layout regressions the translation exposed
  (sidebar label wrapping, truncated select placeholder, two-line banner).
- **Tooling** - APK repack/re-sign, Xamarin assembly extraction, the translation
  pipeline, and a logging proxy used to discover which hosts the client talks to.

See [NOTICE.md](NOTICE.md) before you redistribute anything.

## Requirements

- Windows 10/11 x64
- .NET SDK or runtime 8.0+ (this fork was validated on 10.0.x using
  `rollForward: LatestMajor`)
- The upstream `PGR 本地服务.apk` (4.9.1) to extract the server binaries and assets
- Punishing: Gray Raven **4.9.1** client
- ~4 GB free for the server tree, plus the client's own ~69 GB

## Quick start (server only)

```powershell
# 1. Extract server assemblies from the upstream APK (see tools/)
python tools/xamarin_store_extract.py <libassembly-store.so> assemblies-x64
powershell -File tools/rename_assemblies.ps1

# 2. Lay out the server directory and run it
#    <server-win>\  Configs\  table\  Data\  Resources\   plus the assemblies
dotnet AscNet.dll
```

Expected output:

```
[TableReaderV2] Loaded 1096 tables in 2051ms
[Server]     GameServer started and listening on port 2335
[SDKServer]  SDKServer listening on http://[::]:80, https://[::]:443
```

## Architecture

```
client  --(SDK/gate)-->  SDKServer  :80/:443   login, config.tab, notices
        --(game)------>  GameServer :2335      custom TCP protocol
        --(assets)---->  PgrPhoneHost          matrix/launch indexes, GM + player API
```

`/api/Login/Login` returns `{ code, ip, port, token }`; the client then opens the
game socket to `ip:port`. The GM and player panels are served by the Android-only
`PgrPhoneHost`, which is the piece this fork still has to rebuild for Windows.

Details, evidence and open questions: [docs/architecture.md](docs/architecture.md).

## Roadmap

- [x] Identify the engine and the modifiable surface of both APKs
- [x] Extract and identify all server assemblies; decompile to C# for reference
- [x] Run `AscNet` natively on Windows (SQLite, tables, both listeners)
- [x] Translate the web panel to English, fix the broken asset paths and EN layout
- [ ] Discover the hosts the EN client contacts (logging proxy is ready)
- [ ] Intercept the SDK/gate calls and answer them from the local server (MITM)
- [ ] Rebuild the GM/player API host for Windows (port of `PgrPhoneHost`)
- [ ] Translate in-game text (blocked: assets sit in Kuro's encrypted bundles)

## Known limitations

- The upstream server targets the **CN** client (`com.kurogame.haru.hero`) and
  redirects it by rewriting a Lua config file inside the game. The **global/EN**
  client has no such file - verified by scanning the launcher, `GameAssets`,
  `PGRBase`, `GameBase` and the whole `StreamingAssets` tree - so the EN client
  has to be redirected at the network layer instead.
- No in-game text translation. Item, story and UI text live inside bundles with
  the `HARUINKUROGAME` header and need decryption first.
- Friends, rankings, chat and co-op do not work: there is one player.

## Safety

Use a **local account** created by the server, never real Kuro credentials, and
never point a patched client at the official servers. The client launcher script
in `tools/` exists so the normal game shortcut keeps its original behaviour.

## License and provenance

Original work in this repository is MIT (see [LICENSE](LICENSE)). The upstream
private server, its binaries, data tables and the web panel are **not** ours and
carry no license from us - read [NOTICE.md](NOTICE.md). The author of the
upstream server is unknown; it was obtained through a public archive channel.