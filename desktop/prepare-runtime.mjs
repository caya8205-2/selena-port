// Assembles desktop/runtime for the portable and the installer build.
//
// The person installing Selena-port owns a game, not a toolchain: nothing is cloned or built on their
// machine, and nothing of the .NET SDK is assumed to be installed there either. The server is therefore
// published self-contained, so AscNet.exe runs on a clean Windows box with no dotnet on PATH.
//
//   npm run prepare-runtime             publish Release, self-contained
//   npm run prepare-runtime -- --reuse  reuse desktop/runtime/server as it stands (no build, no network)
//
// Sources: AscNet/AscNet.csproj for the server, mongod.exe for the database (SELENA_MONGOD, or the path the
// dev config already points at). Table data comes through electron-builder's extraResources.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const desktop = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(desktop, '..')
const runtime = path.join(desktop, 'runtime')

const serverFrom = path.join(repo, 'AscNet', 'AscNet.csproj')
const serverTo = path.join(runtime, 'server')
const mongoTo = path.join(runtime, 'mongodb')
const reuse = process.argv.includes('--reuse')

const mongoCandidates = [
  process.env.SELENA_MONGOD,
  'D:\\mongo\\mongodb-win32-x86_64-windows-7.0.48\\bin\\mongod.exe',
].filter(Boolean)

function fail(message) {
  console.error(`prepare-runtime: ${message}`)
  process.exit(1)
}

const publish = !reuse && fs.existsSync(serverFrom) && spawnSync('dotnet', ['--version']).status === 0

if (publish) {
  fs.rmSync(runtime, { recursive: true, force: true })
  fs.mkdirSync(runtime, { recursive: true })
  const args = [
    'publish', serverFrom,
    '-c', 'Release',
    '-r', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishReadyToRun=false',
    '-o', serverTo,
    '--nologo',
  ]
  console.log('prepare-runtime: dotnet ' + args.join(' '))
  const build = spawnSync('dotnet', args, { stdio: 'inherit' })
  if (build.status !== 0) fail('dotnet publish failed; fix the build before packing')
} else if (fs.existsSync(path.join(serverTo, 'AscNet.exe'))) {
  console.log('prepare-runtime: reusing ' + serverTo)
} else {
  fail('no server to pack: run without --reuse, or build AscNet first')
}

// A self-contained publish puts the runtime next to the apphost. Without these two the exe expects .NET on
// the player's machine, which is exactly what this script exists to avoid.
for (const file of ['coreclr.dll', 'hostfxr.dll']) {
  if (!fs.existsSync(path.join(serverTo, file))) {
    console.warn(`prepare-runtime: warning: ${file} missing, the server would need .NET installed on the target`)
  }
}

const mongo = mongoCandidates.find((candidate) => fs.existsSync(candidate))
if (!mongo) {
  fail('mongod.exe not found. Set SELENA_MONGOD to its full path, for example\n'
    + '  SELENA_MONGOD=D:\\mongo\\mongodb-win32-x86_64-windows-7.0.48\\bin\\mongod.exe npm run prepare-runtime')
}

fs.mkdirSync(mongoTo, { recursive: true })

fs.copyFileSync(mongo, path.join(mongoTo, 'mongod.exe'))

const size = (dir) => {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size
  }
  return total
}

console.log(`prepare-runtime: server ${fs.readdirSync(serverTo).length} files, ${Math.round(size(serverTo) / 1e6)} MB`)
console.log(`prepare-runtime: mongod ${Math.round(size(mongoTo) / 1e6)} MB`)
console.log('prepare-runtime: ready, electron-builder packs desktop/runtime as extraResources')