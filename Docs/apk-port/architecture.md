# Architecture, evidence and open questions

Everything here was verified on a real install, not inferred.

## 1. Upstream Android package

`PGR 本地服务.apk` (177 MB, `com.moan.moxiaohero.localhost.v49`, v4.9.1,
`targetSdk 29`, `minSdk 24`, `extractNativeLibs=true`).

```
assets/pc-server.zip                 server data: Configs/ (57 MB), table/ (40 MB), Data/
assets/server-resources/Web/         GM panel + player panel (HTML/CSS/JS)
assets/server-resources/asc49/       server-side asset bundles (index + .uab)
assets/matrix-index*                 index variants the proxy serves
lib/arm64-v8a, lib/x86_64            mono runtime + libassembly-store.so (50 MB each)
lib{arc,xamarin-app}.so              bundle manifest / hashes (no readable strings)
```

The Java layer is a shell: `classes.dex` is 412 KB.

## 2. Server binaries

All 373 managed assemblies live in `lib/x86_64/libassembly-store.so`:

- ELF wrapper, `XABA` store header at `0x4000`, 374 descriptors, payloads as
  `XALZ` blobs (LZ4 block).
- Decompress each `XALZ` payload independently (do not trust the descriptor
  table; reading it directly yields bogus offsets for this store version).
- Real assembly names are recovered with
  `[System.Reflection.AssemblyName]::GetAssemblyName()` - the store does not
  carry a plain name table.

Resulting identities:

```
AscNet.dll             entry point (EntryPointToken present)
AscNet.GameServer.dll  game protocol
AscNet.Common.dll      config, SqlSugar database, tables
AscNet.SDKServer.dll   Kestrel host: login, config.tab, notices
AscNet.Logging.dll
PgrPhoneHost.dll       reverse proxy + GM/player panel host (Mono.Android)
PgrRuntime.dll         Android glue
Microsoft.AspNetCore.* Kestrel 8.0.30 and the ASP.NET Core stack
SQLitePCLRaw.* 2.1.11  SQLite binding (bundled for Android)
MongoDB.Driver.*       present, unused at runtime
```

Target framework is `net8.0`; on a .NET 10 runtime it runs with
`"rollForward": "LatestMajor"`.

## 3. Windows host requirements found by running it

Failure without the fix:

```
System.TypeInitializationException: 'AscNet.Common.Common'
 -> SqlSugarException: connection open error
 -> The type initializer for 'Microsoft.Data.Sqlite.SqliteConnection' threw
```

Cause: `SQLitePCLRaw.lib.e_sqlite3.android` ships the Android `.so`. Fix: drop
`e_sqlite3.dll` (win-x64, SQLitePCLRaw 2.1.11) next to `AscNet.dll`.

Working startup:

```
[TableReaderV2] Loaded 1096 tables in 2051ms
[Server]     GameServer started and listening on port 2335
[SDKServer]  SDKServer listening on http://[::]:80, https://[::]:443
```

Directory layout the server expects (`AscNet.Program.Main`):

- `Configs/version_config.json` (from `pc-server.zip`), otherwise it changes
  directory into `Resources/` and looks for `Resources/Configs`
- `table/` and `Data/` from `pc-server.zip`
- `Resources/` for `Web/` and `asc49/`
- database: `Configs/config.json` -> SqlSugar / Sqlite / `Data Source=asc_net.db`,
  `DataPath: ../存档`

SQLite, not MongoDB: `Configs/config.json` sets `SqlSugarDbType: Sqlite`.
`--shutdown-local-mongo` exists only as a leftover utility.

## 4. Server HTTP surface (from `AscNet.SDKServer`)

```
/api/Login/Login                 gate login, returns { code, ip, port, token }
/api/Login/Login-cn              same, CN flavour
/api/AscNet/commands
/prod/client/config/{cdnKey}/{package}/{version}/standalone/config.tab
/prod/client/notice/...          Login / ScrollText / ScrollPic / Game / SecondMenu notices
```

Ports come from `GetUrls(args)`, so they can be overridden at launch.

## 5. Panel host (`PgrPhoneHost`, Android only)

It is a reverse proxy, not a static server:

- serves bundled `matrix/index` and `launch/index` (patched variants live in
  `assets/matrix-index*`), proxying everything else upstream
- `/gm/`, `/player/`, `/gm/gm.js` - the panel itself
- `/api/AscNet/gm/*`, `/api/AscNet/register|login|verify`, `/api/player/*`
- also writes the client-side config used by the CN client:

```
ServerListStr       = 星火服#http://127.0.0.1:32750/api/Login/Login-cn
ServerListStr_4.8.0 = same
CloseMsgEncrypt     = 0
WatermarkEnabled    = 0
IndexSha1 / LaunchIndexSha1 / LaunchModuleVersion = 4.8.14
AndroidPayCallbackUrl = http://127.0.0.1:32750/api/XPay/KuroPayResult
```

Because it links Mono.Android it cannot run on Windows as-is. The Windows port
only needs its HTTP surface, so it can be rebuilt as a small ASP.NET app on top
of `AscNet.Common`/`AscNet.GameServer` with `ReadAsset` replaced by plain file
reads.

## 6. Client side

Installed PC client: `E:\Punishing Gray Raven`, `version.json` -> **4.9.1**,
which matches the server's `asc49` data.

```
PGR.exe (0.4 MB) + UnityPlayer.dll (29.6 MB) + GameAssembly.dll (166.7 MB, IL2CPP x64)
PGRBase.dll (32.8 MB)
PGR_Data/Plugins/KRSDK.dll, libkrsdkcurl.dll, KRSDKExternal.exe
PGR_Data/Plugins/KRSDKRes/cacert.pem   <- 142 CAs, the SDK's own trust store
PGR_Data/il2cpp_data/Metadata/global-metadata.dat  -> 8 bytes (stub; real data is downloaded)
PGR_Data/StreamingAssets/document/{ver,client2cdn,origin_index}
```

`StreamingAssets/document/client2cdn` says
`GameIdentifier: com.kurogame.pc.punishing.grayraven.en`, `BuildChannel: EN` -
this is the **global** client, while the upstream server targets the CN client.

### Why the CN redirect does not apply here

The CN flow rewrites a Lua config in the game's `matrix` folder. Searching the EN
installation for `ServerListStr`, `Login-cn`, `CloseMsgEncrypt`,
`LaunchIndexSha1` and `KuroPayResult` returned **zero hits** across:

- the whole `StreamingAssets` tree and `document/*`
- `kr_game_cache/*.json` and the `2.6.3.0` launcher directory
- `GameAssembly.dll` (all 166 MB), `PGRBase.dll`, `PGR.exe`, `UnityPlayer.dll`

So the EN client has no such config; it gets its server list through the native
`KRSDK` over HTTPS. Redirect has to happen at the network layer.

### Discovery method

`tools/logging_proxy.py` is a stdlib-only CONNECT/SNI logging proxy; the client is
started with `HTTP(S)_PROXY` set (libcurl honours it) via
`tools/run_discovery.bat`. It relays traffic unmodified, so this phase records
hosts without changing the client or its behaviour.

Static identification attempts that came up empty (recorded so they are not
repeated): reverse DNS on the observed IPs (no PTR records), the CrashSight log
(only `pc.crashsight.wetest.net`), `launcher.exe` and `KRLauncher*.dll` strings
(no Kuro hostnames), and `openssl s_client` against the IPs (Cloudflare edge
returns the default `icanhazip.com` certificate, Tencent/Aliyun need a real SNI).

## 7. Interception plan

1. Append this fork's CA to `PGR_Data/Plugins/KRSDKRes/cacert.pem` (backup first).
   The SDK reads that bundle, not the Windows trust store.
2. Redirect the discovered hosts to `127.0.0.1` and let the proxy forward to the
   local `SDKServer`.
3. Answer the gate call with `{ code: 0, ip: "127.0.0.1", port: 2335, token }`
   so the client opens the game socket to our `GameServer`.

Open question: whether `KRSDK` pins certificates. If it does, interception moves
to patching the client's TLS layer, which is a much larger job.

## 8. Open questions

- Does the server distinguish CN vs EN in the gate/CDN responses? Both
  `/api/Login/Login` and `/api/Login/Login-cn` exist, which suggests it handles both.
- Do the CN data tables match the EN client's table ids? Same version (4.9.1),
  but that is not proof.
- Anti-cheat: `PGR_Data/AntiCheatExpert` is present. Whether it objects to a
  redirected client is unknown until tested.