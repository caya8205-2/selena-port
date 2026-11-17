# Selena-port

Play **Punishing: Gray Raven** on your own PC, against a private server that runs on your machine.

Selena-port is a fork of [InfiniteLoop](https://github.com/reiserFSs/InfiniteLoop), which itself is a branch of
[AscNet](https://github.com/rafi1212122/AscNet). The server side is upstream's work; this fork adds the thing
that was missing for a player: an app that sets the whole stack up for you, and a panel that shows a save
instead of a chat prompt. What changed and why is in [SELENA.md](SELENA.md); licensing is documented in
[LICENSE.md](LICENSE.md) and [NOTICE.md](NOTICE.md).

This is a fan project, not an official service. Everything runs locally: your progress is stored on your
computer, and there are no other players unless you share your server.

## What you need

- A Windows 10/11 PC (64-bit). The app is the supported path; the launcher and server can still be run by hand.
- A Punishing: Gray Raven install you are allowed to modify: the official launcher's folder or the Steam copy.
- An internet connection for the first setup (the app downloads the tools it needs) and for updates.

## Getting started

Download **`Selena-port-Setup-<version>.exe`** from the
[latest release](https://github.com/caya8205-2/selena-port/releases/latest) and install it, or run
**`Selena-port-Portable-<version>.exe`** without installing anything. Both open the same app, and the portable
build keeps its data in the same place as the installed one.

On first launch a setup dialog lists what the machine still needs. Each line carries its own button:

1. **Where the game is.** The app looks for the game itself and fills the folder in; **Choose folder** is there
   when it cannot tell, or when you keep more than one copy.
2. **.NET SDK.** Installs for the current Windows user, with no admin prompt. The server is built with it.
3. **Git.** Fetches the server source, and later pulls its updates instead of downloading them again.
4. **Server source.** Clones the checkout the app builds from. Keep it: an update is a pull, not a new copy.
5. **Server build.** Compiles the server from that checkout.
6. **Database.** Installs MongoDB inside the app's own folder.
7. **Launcher.** Applies and restores the game patch. It ships as its own download.
8. **Game patch.** Applied the first time the game starts; the original files are copied aside first.

Press **Start** when every line reads ready. The dialog closes itself and the Console shows the stack running.

Then open **Accounts**, press **Create account**, and **Launch game** from the Console. In the game's login
screen use the same email and password you created; the save belongs to that account.

From there, reach the lobby before pressing Perform in the panel. Writes made while the game is closed are
stored, but the client only shows them at its next login; [Commands and Perform](#commands-and-perform) covers
what that looks like in the log.

After the first time, the app opens on the Console: **Start** brings the stack up, **Launch game** starts the
client.

## Updating

Two different things update on two different schedules:

- **The app itself** ships as a new release when the version changes, and the version is the date
  (`26.11.18`). Install the new one over the old.
- **The server source** updates in place. **Config → Update source** pulls the checkout the app already has and
  rebuilds it, so a new commit costs a diff and a compile instead of another download. The **Update** tab
  watches the repository this checkout came from and says whether a newer commit exists.

## Where things live

`%APPDATA%\Selena-port` holds everything the app keeps, and `%LOCALAPPDATA%\Microsoft\dotnet` holds the .NET
SDK it installed:

| What | Where |
| --- | --- |
| Settings | `%APPDATA%\Selena-port\config.json` |
| App, server and database logs | `%APPDATA%\Selena-port\logs\` (`app.log`, `server.out.log`, `mongo.out.log`) |
| Player database | `%APPDATA%\Selena-port\mongo-data` |
| Downloaded tools (Git, MongoDB, launcher) | `%APPDATA%\Selena-port\tools\` |
| Server source and its build | `%APPDATA%\Selena-port\repo` |
| Launcher log | `launcher.log`, next to `AscNetLauncher.exe` |
| Game patch log | `ascnet-patch.log`, next to `PGR.exe` in the game folder |
| Game log | the newest file in `%USERPROFILE%\AppData\LocalLow\kurogame\PGR\log\` |

The panel keeps no copy of its own: it reads the database the server writes.

## Tips

- **Chat commands** still work: type `/help` in the in-game chat for currency, items, characters, levels and
  stage clears.
- **The panel** does the same work with controls: grant items, tune a construct's level, rank, memories and
  resonances, clean out spares, and apply one tab to every entry at once with **Tutti**.
- **Client mods:** the launcher's **SETTINGS → CLIENT MODS** switch enables the debug menu and the included
  mods. Restart the game afterwards; the GM menu opens with **Ctrl+Shift+D**.
- **Repairing the game:** the launcher's **SETTINGS → Game client…** has **VERIFY & REPAIR**, which re-checks
  every file and re-downloads anything damaged. For the Global client it also restores the in-game patch files
  from Kuro's servers, about 3.7 GB the first time.

## Commands and Perform

The panel talks to the server, not to the game client, and that explains the one confusing result you will
meet: a Perform that reports success and changes nothing you can see.

- **Reads are always current.** Accounts, the item and construct catalogs, memory sets and the Update tab read
  the database the server owns, so they work with the game closed.
- **A Perform reaches the game when the game is open.** The server runs every command either against your live
  session - the pushes arrive in the client at once - or, when you are not in game, against an offline session
  built from the same documents. Either way the write lands; only the moment you see it differs.
- **The log says which happened.** A Perform that ran without a live session ends with "stored in the database -
  the game client shows it at its next login". That is a success, not a failure.
- **An account has no player until it logs in once.** Creating it in the app only writes the login; the
  construct roster, inventory and progress are created by the game at its first sign-in. A Perform against such
  an account answers "this account has no player yet - log in once from the game".

So the order is: **Start** the stack, **Launch game**, log in once, and from then on the panel works either way.
If a Perform looks like it did nothing, log out and back in, or close the game and start it again from the
Console: the account is fine, the client's copy was just older than the database.

## What works

Most of the game is playable: story, characters and gear, gacha, shops, tasks, events, guilds, dorms, friends
and the regular PvE modes.

Some things are missing or limited:

- **Multiplayer and co-op rooms** don't work yet.
- **Some older or minor events** have no server support.
- **A few rewards, shops and banners stay closed** because the game files don't contain the data needed to run
  them; [Docs/closed.md](Docs/closed.md) lists each one.
- **Event calendars:** the game files don't include the official calendar, so some events are simply always
  open.

## Having a problem?

When you report a bug, include what you did, what happened, your game language, and the logs. The app's
**Open logs** button opens the folder the first three live in.

If the game doesn't reach the login screen, the
[player diagnostics guide](AscNet.Launcher/docs/player-diagnostics.md) explains what the patch log lines mean.

## For developers

The app is Electron plus the panel's own HTML, CSS and JS; the server is .NET 8. From the repository root:

```bash
cd desktop && npm install && npm run dev      # the app, pointed at this checkout
dotnet build AscNet/AscNet.csproj             # the server the app runs
cd AscNet.Launcher && cargo build --release   # the launcher, a separate program
```

`SELENA_USER_DATA=<folder> npm run dev` starts the app against a scratch profile, which is how the first-run
dialog gets tested on a machine that is already set up. Nothing in the default profile is touched.

Building the server, running it without the app, the protocol and feature notes, and the test suite are in the
[developer guide](Docs/development.md). Repository rules for contributors and agents are in
[AGENTS.md](AGENTS.md).
