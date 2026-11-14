# Licensing

This repository is a **fork**, so licensing is mixed. Nothing here is a single
blanket license. Read this before you copy code out of it.

## Map

| Part | Origin | License |
|---|---|---|
| `AscNet/`, `AscNet.Common/`, `AscNet.GameServer/`, `AscNet.SDKServer/`, `AscNet.Table/`, `AscNet.Logging/`, `AscNet.Patch/`, `AscNet.PcapParser/`, `AscNet.Test/`, `Mods/`, `Resources/`, `Docs/`, `proxy.py`, `run_steam.py`, `Scripts/` | upstream [InfiniteLoop](https://github.com/reiserFSs/InfiniteLoop), itself a branch of [AscNet](https://github.com/rafi1212122/AscNet) | **No license file upstream: no rights granted.** Not relicensed here. |
| `AscNet.Launcher/` | upstream | **GPL-3.0** (`AscNet.Launcher/LICENSE`). Any modification in this fork stays GPL-3.0. |
| `web-ui/` (English panel, bug fixes, layout adjustments) | authored by this fork | **MIT** |
| `tools/apk-port/` (extraction, translation pipeline, repack, logging proxy) | authored by this fork | **MIT** |
| `SELENA.md`, `NOTICE.md`, `docs/apk-port/` | authored by this fork | **MIT** |

## MIT license (applies to this fork's own files only)

Copyright (c) 2026 Selena-port contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
the files identified as MIT in the table above (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Note on GPL-3.0

If you distribute a build that includes `AscNet.Launcher`, that build is covered
by GPL-3.0: you must provide the corresponding source and keep the same license
for the launcher parts. The MIT files above can still be used under MIT, but a
combined distribution must satisfy GPL-3.0 as a whole.

## Game content

Punishing: Gray Raven, its client, bundles, tables and text belong to Kuro Games.
No game assets are shipped in this repository.