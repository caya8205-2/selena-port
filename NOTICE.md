# NOTICE - provenance

Selena-port is a **fork**, not an original private server. This file records what
came from where so that nobody, including future us, has to guess.

## Upstream chain

```
rafi1212122/AscNet          Punishing: Gray Raven private server (C#)   no LICENSE file
        |
        +-- reiserFSs/InfiniteLoop   "AscNet Evolved", PC/Steam + Kuro launcher support,
        |                            GLO/TW/CN/JP/KR, launcher in Rust/Slint
        |                            server: no LICENSE file, launcher: GPL-3.0
        |
        +-- Selena-port  (this fork) web self-service panel + Android-port reference
```

The Android repack `PGR 本地服务.apk` (v4.9.1, `com.moan.moxiaohero.localhost.v49`)
that this fork's research started from is a redistribution of the same server
family, published by a third-party archive channel that is **not** the author.
It was used as a reverse-engineering reference only.

## What is ours

- `web-ui/` - English translation of the GM/player panel, the fix for its broken
  CSS/JS paths, and the English layout adjustments
- `tools/apk-port/` - extraction, translation, repack and discovery tooling
- `docs/apk-port/` - reverse-engineering notes for the Android repack
- `SELENA.md`, `NOTICE.md`, `LICENSE.md`

Those are MIT ([LICENSE.md](LICENSE.md)).

## What is not ours

- All `AscNet.*` server projects, `Mods/`, `Resources/`, `Docs/`, `proxy.py`,
  `run_steam.py` and `Scripts/` come from upstream InfiniteLoop/AscNet. No license
  file exists upstream for these, so **no rights are granted and none are granted
  by us**. They are kept here because a fork has to contain them to build.
- `AscNet.Launcher/` comes from upstream under **GPL-3.0**.
- Punishing: Gray Raven, its client binaries, bundles, tables, characters, music
  and text belong to Kuro Games. No game assets ship in this repository.
- Third-party libraries inside the server projects (ASP.NET Core, Kestrel,
  SqlSugar, MongoDB.Driver, SQLitePCLRaw, Mono, Xamarin) keep their own licenses.

## Authorship statement

We do not claim the private server. The server, its protocol handling and its
data are upstream work by the AscNet/InfiniteLoop authors. This fork's
contribution is the web panel (English UI, fixed asset paths, verified layout),
the Windows/APK-port research notes, and the tooling - plus the adjustments
needed to make those pieces coexist with upstream.

If you are an upstream author and want credit changed or material removed, open
an issue and it will be handled.

## Responsible use

- Local accounts only. Never enter real Kuro credentials into a redirected client.
- Do not point a redirected client at the official servers.
- Do not sell or paywall this. The upstream README states the resource is free
  and that anyone charging for it is scamming people.