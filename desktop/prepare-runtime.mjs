// Assembles desktop/runtime for the portable build.
//
// The person installing Selena-port owns a game, not a toolchain: they should not clone a repository or
// build a .NET project. Everything the app needs to run a server ships inside the installer, and this
// script is what puts it there before electron-builder packs the app.
//
//   npm run prepare-runtime
//
// Sources: the built server under AscNet/bin/Debug/net8.0, and mongod.exe (SELENA_MONGOD, or the path the
// dev config already points at). Table data comes from Resources/table through electron-builder's
// extraResources, so it is not copied here.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(desktop, '..')
const runtime = path.join(desktop, 'runtime')

const serverFrom = path.join(repo, 'AscNet', 'bin', 'Debug', 'net8.0')
const serverTo = path.join(runtime, 'server')
const mongoTo = path.join(runtime, 'mongodb')

const mongoCandidates = [
  process.env.SELENA_MONGOD,
  'D:\\mongo\\mongodb-win32-x86_64-windows-7.0.48\\bin\\mongod.exe',
].filter(Boolean)

function fail(message) {
  console.error(`prepare-runtime: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(serverFrom, 'AscNet.dll'))) {
  fail(`no server build at ${serverFrom}. Run: dotnet build AscNet/AscNet.csproj`)
}

const mongo = mongoCandidates.find((candidate) => fs.existsSync(candidate))
if (!mongo) {
  fail('mongod.exe not found. Set SELENA_MONGOD to its full path, for example\n'
    + '  SELENA_MONGOD=D:\\mongo\\mongodb-win32-x86_64-windows-7.0.48\\bin\\mongod.exe npm run prepare-runtime')
}

fs.rmSync(runtime, { recursive: true, force: true })
fs.mkdirSync(serverTo, { recursive: true })
fs.mkdirSync(mongoTo, { recursive: true })

fs.cpSync(serverFrom, serverTo, { recursive: true })
fs.copyFileSync(mongo, path.join(mongoTo, 'mongod.exe'))

// The app launches AscNet.exe from this folder; the apphost needs its deps beside it, and the build
// output already carries them, so nothing else is assembled here.
const carried = fs.readdirSync(serverTo)
console.log(`prepare-runtime: server ${carried.length} files -> ${serverTo}`)
console.log(`prepare-runtime: mongod -> ${path.join(mongoTo, 'mongod.exe')}`)
console.log('prepare-runtime: ready, electron-builder will pack desktop/runtime as extraResources')