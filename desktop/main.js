// Selena-port desktop shell.
//
// Three jobs, all in one process so the user never sees a terminal:
//   1. serve the panel (web-ui) and proxy its API to the game server
//   2. supervise the stack (mongod + AscNet) and the patched client
//   3. hand a small status/command API to the shell window over IPC
//
// The .NET panel project is not needed at runtime: the two read-only catalog
// endpoints and the proxy are implemented here, which keeps the shipped app to
// Electron + the server publish + mongod.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')
const { buildChecks } = require('./verify')
const { createBackup, listBackups } = require('./backup')
const { detectGameDir } = require('./game-detect')

// ---------------------------------------------------------------- settings

const isPackaged = app.isPackaged
// Dev means running from the repo. In that case the renderer files are watched and the
// window reloads itself on save, so a CSS or JS edit does not need a manual restart.
const isDev = !isPackaged

// One console at a time. A second launch focuses the window that is already open instead of
// stacking another one, which used to leave two panels listening on two ports.
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  // A second launch has nothing to do: quit and let the running window take over. The rest
  // of this file is skipped so it cannot race a half-started app.
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
}

const resources = isPackaged ? process.resourcesPath : path.join(__dirname, '..')

const defaults = {
  sdkPort: 8085,
  gamePort: 2335,
  mongoPort: 27017,
  mongoBinary: isPackaged
    ? path.join(resources, 'runtime', 'mongodb', 'mongod.exe')
    : 'D:\\mongo\\mongodb-win32-x86_64-windows-7.0.48\\bin\\mongod.exe',
  serverDir: isPackaged
    ? path.join(resources, 'runtime', 'server')
    : path.join(__dirname, '..', 'AscNet', 'bin', 'Debug', 'net8.0'),
  // Filled in by detectGameDir at startup: a path here would be one machine's, not the player's.
  gameDir: '',
  tableDir: isPackaged ? path.join(resources, 'table') : path.join(__dirname, '..', 'Resources', 'table'),
  webUi: isPackaged ? path.join(__dirname, 'web-ui') : path.join(__dirname, '..', 'web-ui'),
  repoRoot: isPackaged ? '' : path.join(__dirname, '..'),
  repoUrl: '',
  repo: '',
  // Where mongod keeps its files. The desktop app and the control-centre script must
  // agree here, or "start" silently opens a different database than the one the user
  // already has accounts in.
  mongoDataDir: '',
}

function readConfig() {
  const file = path.join(app.getPath('userData'), 'config.json')
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...defaults, ...saved }
  } catch {
    return { ...defaults }
  }
}

const config = readConfig()
const devPaths = path.join(__dirname, 'dev-paths.json')
if (!isPackaged && fs.existsSync(devPaths)) {
  try { Object.assign(config, JSON.parse(fs.readFileSync(devPaths, 'utf8'))) } catch { /* ignore */ }
}

function mongoDataPath() {
  return config.mongoDataDir || path.join(app.getPath('userData'), 'mongo-data')
}
const logDir = path.join(app.getPath('userData'), 'logs')

// ---------------------------------------------------------------- services

const running = { mongo: null, server: null }
const logLines = []

function log(line) {
  const text = `${new Date().toLocaleTimeString()}  ${line}`
  logLines.push(text)
  if (logLines.length > 400) logLines.shift()
  // Kept on disk as well: a failure that only lived in the pane was unreadable the moment the window
  // was restarted, and the owner had to paste it back by hand.
  try {
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(path.join(logDir, 'app.log'), text + String.fromCharCode(10))
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stack:log', text)
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (result) => { socket.destroy(); resolve(result) }
    socket.setTimeout(700)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function waitPort(port, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// The game port is never probed with a connection: the server treats any connect as a client, opens a
// session, saves state and disconnects, which floods its log and can race a real login. It is asked the
// other way round instead: the child this app spawned, or the pid the control centre recorded.
function recordedPid(name) {
  try {
    const file = path.join(config.repoRoot || path.join(__dirname, '..'), 'tools', '.run', `${name}.pid`)
    const value = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch { return 0 }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (err) { return err.code === 'EPERM' }
}

// Listing ports answers for a stack nobody recorded, without touching it.
function portListening(port) {
  let out = ''
  try {
    out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true }).stdout || ''
  } catch { return false }
  for (const raw of out.split('\n')) {
    const line = raw.replace('\r', '').trim()
    if (!line || line.includes('LISTENING') === false) continue
    const cols = line.split(/\s+/)
    if (cols.length < 4 || cols[3] !== 'LISTENING') continue
    const local = cols[1] || ''
    if (Number(local.slice(local.lastIndexOf(':') + 1)) === port) return true
  }
  return false
}

let gameUpAt = 0
let gameUpSeen = false

async function gameServerUp() {
  const child = running.server
  if (child && !child.killed && child.exitCode === null) return true
  const pid = recordedPid('server')
  if (pid > 0 && processAlive(pid)) return true
  // netstat costs a process spawn, so the answer is kept for a few seconds. It cannot disturb the
  // game server the way a connect did, so the cache is about cost, not about avoiding damage.
  if (Date.now() - gameUpAt < 4000) return gameUpSeen
  gameUpSeen = portListening(config.gamePort)
  gameUpAt = Date.now()
  return gameUpSeen
}


async function status() {
  return {
    mongo: await portOpen(config.mongoPort),
    sdk: await portOpen(config.sdkPort),
    game: await gameServerUp(),
    mongoPort: config.mongoPort,
    sdkPort: config.sdkPort,
    gamePort: config.gamePort,
    gameDir: config.gameDir,
    serverDir: config.serverDir,
  }
}

// The stack outlives this window. A child whose stdout is a pipe to this process dies the moment the
// panel is force quit or crashes, because its next write hits a closed pipe: that is how a console
// restart took the game server down with it. A detached child writing to its own file survives it.
function spawnHidden(file, args, options = {}) {
  const { logName, ...spawnOptions } = options
  try {
    return spawnHiddenUnsafe(file, args, logName, spawnOptions)
  } catch (err) {
    err.message = `${path.basename(file)}: ${err.message}`
    throw err
  }
}

function spawnHiddenUnsafe(file, args, logName, spawnOptions) {
  let child
  if (logName) {
    const logFile = path.join(logDir, logName)
    fs.mkdirSync(logDir, { recursive: true })
    const fd = fs.openSync(logFile, 'a')
    try {
      child = spawn(file, args, { windowsHide: true, detached: true, stdio: ['ignore', fd, fd], ...spawnOptions })
    } finally {
      fs.closeSync(fd)
    }
    child.unref()
    log(`${path.basename(file)} running detached, output in ${logFile}`)
  } else {
    child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions })
    child.stdout.on('data', (chunk) => log(chunk.toString().trim()))
    child.stderr.on('data', (chunk) => log(chunk.toString().trim()))
  }
  child.on('exit', (code) => log(`${path.basename(file)} exited with ${code}`))
  return child
}

// A failed create reports on 'error' long before the port could open, so surfacing it at once beats
// waiting out the readiness window and reporting "did not start listening" for a create that never ran.
async function untilListening(child, port, seconds, label) {
  const failed = new Promise((_, reject) => {
    child.once('error', (err) => reject(new Error(`${label}: ${err.message}`)))
  })
  return Promise.race([waitPort(port, seconds), failed])
}

async function spawnReady(label, build, port, seconds, onChild) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let child = null
    // The create itself throws EBUSY synchronously when the image or its working directory is locked,
    // so the attempt has to sit inside the catch, not only the readiness wait.
    try {
      child = build()
      onChild(child)
      const ready = await untilListening(child, port, seconds, label)
      if (ready) return child
      lastError = new Error(`${label} did not start listening on ${port}`)
    } catch (err) {
      lastError = err
    }
    if (child) { try { child.kill() } catch {} }
    if (!/EBUSY|EAGAIN/.test(String(lastError.message)) || attempt === 3) break
    await new Promise((resolve) => setTimeout(resolve, 900))
  }
  throw lastError
}

async function startMongo() {
  if (await portOpen(config.mongoPort)) { log('mongod already listening'); return }
  if (!fs.existsSync(config.mongoBinary)) throw new Error(`mongod not found at ${config.mongoBinary}`)

  const mongoDataDir = mongoDataPath()
  fs.mkdirSync(mongoDataDir, { recursive: true })
  await spawnReady('mongod', () => spawnHidden(config.mongoBinary, [
    '--dbpath', mongoDataDir,
    '--port', String(config.mongoPort),
    '--bind_ip', '127.0.0.1',
    '--logpath', path.join(logDir, 'mongod.log'),
    '--logappend',
  ], { cwd: mongoDataDir, logName: 'mongo.out.log' }), config.mongoPort, 60, (child) => { running.mongo = child })
  log('mongod ready')
}

// Where the .NET runtime actually lives: the directory of dotnet.exe, found the same way the
// control centre finds it. An apphost cannot locate a runtime installed outside Program Files
// without DOTNET_ROOT, and the user sees "You must install .NET" instead of a server.
function dotnetRoot() {
  if (process.env.DOTNET_ROOT) return process.env.DOTNET_ROOT

  const candidates = []
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    if (entry) candidates.push(path.join(entry, 'dotnet.exe'))
  }
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet', 'dotnet.exe'))

  const found = candidates.find((file) => fs.existsSync(file))
  return found ? path.dirname(found) : ''
}

async function startServer() {
  if (await portOpen(config.sdkPort)) { log('server already listening'); return }

  const exe = path.join(config.serverDir, 'AscNet.exe')
  const dll = path.join(config.serverDir, 'AscNet.dll')
  const root = dotnetRoot()
  const env = root
    ? { ...process.env, DOTNET_ROOT: root, PATH: `${root}${path.delimiter}${process.env.PATH || ''}` }
    : process.env
  const launch = () => {
    if (fs.existsSync(exe) && process.env.SELENA_FORCE_DLL !== '1') {
      return spawnHidden(exe, ['--urls', `http://127.0.0.1:${config.sdkPort}`], { cwd: config.serverDir, env, logName: 'server.out.log' })
    }
    if (fs.existsSync(dll)) {
      const dotnet = root ? path.join(root, 'dotnet.exe') : 'dotnet'
      return spawnHidden(dotnet, ['AscNet.dll', '--urls', `http://127.0.0.1:${config.sdkPort}`], { cwd: config.serverDir, env, logName: 'server.out.log' })
    }
    throw new Error(`server build not found in ${config.serverDir}`)
  }

  await spawnReady('server', launch, config.sdkPort, 120, (child) => { running.server = child })
  log('server ready')
}

async function startAll() {
  fs.mkdirSync(logDir, { recursive: true })
  await startMongo()
  await startServer()
  return status()
}

async function stopAll() {
  for (const key of ['server', 'mongo']) {
    const child = running[key]
    if (child && !child.killed) {
      child.kill()
      log(`${key} stopped`)
    }
    running[key] = null
  }
  return status()
}

function launchClient() {
  if (!config.gameDir) throw new Error('game directory is not configured')
  const exe = path.join(config.gameDir, 'PGR.exe')
  if (!fs.existsSync(exe)) throw new Error(`PGR.exe not found in ${config.gameDir}`)

  const child = spawn(exe, [], {
    cwd: config.gameDir,
    windowsHide: false,
    detached: true,
    env: { ...process.env, ASCNET_PATCH_ORIGIN: `http://127.0.0.1:${config.sdkPort}` },
  })
  child.unref()
  log(`client launched with ASCNET_PATCH_ORIGIN=http://127.0.0.1:${config.sdkPort}`)
}

// ---------------------------------------------------------------- catalogs

const catalogSources = {
  items: { file: 'share/item/Item.tsv', id: 'Id', name: 'Name', extra: null },
  characters: { file: 'share/character/Character.tsv', id: 'Id', name: 'Name', extra: 'TradeName' },
  equips: { file: 'share/equip/Equip.tsv', id: 'Id', name: 'Name', extra: 'Star' },
  // A weapon is the only equip with a weapon skill; memories carry 0 in that column.
  weapons: { file: 'share/equip/Equip.tsv', id: 'Id', name: 'Name', extra: 'Star', owner: 'WeaponSkillId', invert: true },
  // Site 0 is a weapon, 1..6 is the memory slot, so memories are the non-zero rows.
  memories: { file: 'share/equip/Equip.tsv', id: 'Id', name: 'Name', extra: 'Star', owner: 'Site', invert: true, slot: 'Site' },
  stages: { file: 'share/fuben/Stage.tsv', id: 'StageId', name: 'Name', extra: null },
  scenes: { file: 'share/photomode/Background.tsv', id: 'Id', name: 'Name', extra: 'Quality' },
}

const cache = new Map()

function parseTsv(file, idColumn, nameColumn, extraColumn, ownerColumn, filterOwner, invertOwner = false, slotColumn = null) {
  const stat = fs.statSync(file)
  const key = `${file}:${ownerColumn || ''}:${filterOwner || ''}:${invertOwner}:${slotColumn || ''}`
  const hit = cache.get(key)
  if (hit && hit.stamp === stat.mtimeMs) return hit.entries

  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length < 2) return []

  const header = lines[0].split('\t').map((h) => h.trim())
  const at = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())

  const idIndex = at(idColumn)
  const nameIndex = at(nameColumn)
  if (idIndex < 0 || nameIndex < 0) return []

  const extraIndex = extraColumn ? at(extraColumn) : -1
  const ownerIndex = ownerColumn ? at(ownerColumn) : -1
  const slotIndex = slotColumn ? at(slotColumn) : -1

  const entries = []
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i].split('\t')
    if (row.length <= Math.max(idIndex, nameIndex)) continue
    if (ownerIndex >= 0 && filterOwner !== undefined) {
      const same = Number(row[ownerIndex]) === Number(filterOwner)
      if (invertOwner ? same : !same) continue
    }

    const id = Number(row[idIndex])
    const name = (row[nameIndex] || '').trim()
    if (!Number.isFinite(id) || name.length === 0) continue

    // Second line comes from a real column, never invented.
    let meta = ''
    if (extraIndex >= 0) {
      const raw = (row[extraIndex] || '').trim()
      if (extraColumn === 'Star' && raw) meta = `${raw}\u2605`
      else meta = raw
    }

    // A memory's grid number is its Site column, and it decides which of the six slots
    // it may occupy, so the catalog has to carry it.
    if (slotIndex >= 0) {
      const slot = (row[slotIndex] || '').trim()
      if (slot && slot !== '0') meta = meta ? `${meta} · Slot ${slot}` : `Slot ${slot}`
    }

    entries.push({ id, name, meta })
  }

  cache.set(key, { stamp: stat.mtimeMs, entries })
  return entries
}

// A raw table read for the resonance picker: header, rows and an accessor for the generated
// `Name[1]` style columns the game's tables use for arrays.
function tableRows(relativePath) {
  const file = path.join(config.tableDir, ...relativePath.split('/'))
  if (!fs.existsSync(file)) return null

  const stat = fs.statSync(file)
  const key = 'table:' + file
  const hit = cache.get(key)
  if (hit && hit.stamp === stat.mtimeMs) return hit.table

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) return { header: [], rows: [] }

  const header = lines[0].split('\t').map((name) => name.trim())
  const table = {
    header,
    rows: lines.slice(1).map((line) => line.split('\t')),
    column: (name, ordinal = 1) => header.findIndex((column) => column.toLowerCase() === `${name.toLowerCase()}[${ordinal}]`),
  }
  cache.set(key, { stamp: stat.mtimeMs, table })
  return table
}

const RANK_LABELS = ['', 'B', 'A', 'S', 'SS', 'SSS', 'SSS+']

function rankLabel(quality) {
  return RANK_LABELS[quality] || ('Q' + quality)
}

// Everything the tune modal needs, read from the tables: no account is consulted, so a build can
// name a memory or a weapon this account never held.
function tuneCatalog() {
  const characters = tableRows('share/character/Character.tsv')
  const qualities = tableRows('share/character/quality/CharacterQuality.tsv')
  const levels = tableRows('share/character/grade/CharacterGrade.tsv')
  const equips = tableRows('share/equip/Equip.tsv')
  if (!characters || !equips) return null

  const baseQuality = new Map()
  if (qualities) {
    const idAt = qualities.header.indexOf('CharacterId')
    const qualityAt = qualities.header.indexOf('Quality')
    for (const cells of qualities.rows) {
      const id = Number(cells[idAt])
      const quality = Number(cells[qualityAt])
      if (!baseQuality.has(id) || quality < baseQuality.get(id)) baseQuality.set(id, quality)
    }
  }

  const characterRows = []
  const nameAt = characters.header.indexOf('Name')
  const tradeAt = characters.header.indexOf('TradeName')
  const idAt = characters.header.indexOf('Id')
  for (const cells of characters.rows) {
    const id = Number(cells[idAt])
    if (id <= 0) continue
    const quality = baseQuality.get(id) || 1
    characterRows.push({ id, name: cells[nameAt], tradeName: cells[tradeAt] || '', baseQuality: quality, baseRank: rankLabel(quality) })
  }

  const memoryRows = []
  const weaponRows = []
  const equipIdAt = equips.header.indexOf('Id')
  const equipNameAt = equips.header.indexOf('Name')
  const starAt = equips.header.indexOf('Star')
  const siteAt = equips.header.indexOf('Site')
  for (const cells of equips.rows) {
    const id = Number(cells[equipIdAt])
    const site = Number(cells[siteAt])
    const typeAt2 = equips.header.indexOf('Type')
    const entry = { id, name: cells[equipNameAt], star: Number(cells[starAt] || 0), type: Number(cells[typeAt2] || 0) }
    if (site === 0) weaponRows.push(entry)
    else if (site > 0) memoryRows.push(Object.assign({ site }, entry))
  }

  return {
    ranks: [1, 2, 3, 4, 5, 6].map((quality) => ({ quality, label: rankLabel(quality) })),
    characters: characterRows,
    memories: memoryRows,
    weapons: weaponRows,
  }
}

// Per construct: the promotion ladder, its level cap and how many star steps each rank has.
function tuneCharacter(characterId) {
  const grades = tableRows('share/character/grade/CharacterGrade.tsv')
  const fragments = tableRows('share/character/quality/CharacterQualityFragment.tsv')
  const characters = tableRows('share/character/Character.tsv')
  const levelUps = tableRows('share/character/CharacterLevelUp.tsv')
  if (!grades || !characters) return null

  const idAt = characters.header.indexOf('Id')
  const typeAt = characters.header.indexOf('Type')
  const levelTypeAt = characters.header.indexOf('LevelUpTemplateId')
  const character = characters.rows.find((cells) => Number(cells[idAt]) === characterId)
  if (!character) return null

  const characterType = Number(character[typeAt])
  const promotions = []
  const gradeAt = grades.header.indexOf('Grade')
  const characterAt = grades.header.indexOf('CharacterId')
  const nameColumn = grades.header.indexOf('GradeName')
  for (const cells of grades.rows) {
    if (Number(cells[characterAt]) !== characterId) continue
    promotions.push({ grade: Number(cells[gradeAt]), name: cells[nameColumn] || ('grade ' + cells[gradeAt]) })
  }
  promotions.sort((left, right) => left.grade - right.grade)

  // star steps per rank, straight from the fragment table
  const stars = {}
  if (fragments) {
    const typeColumn = fragments.header.indexOf('Type')
    const qualityColumn = fragments.header.indexOf('Quality')
    for (const cells of fragments.rows) {
      if (Number(cells[typeColumn]) !== characterType) continue
      let steps = 0
      for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
        const at = fragments.column('StarUseCount', ordinal)
        if (at >= 0 && Number(cells[at] || 0) > 0) steps += 1
      }
      stars[Number(cells[qualityColumn])] = steps
    }
  }

  let maxLevel = 0
  if (levelUps) {
    const levelAt = levelUps.header.indexOf('Level')
    const levelTypeColumn = levelUps.header.indexOf('Type')
    const template = Number(character[levelTypeAt])
    for (const cells of levelUps.rows) {
      if (levelTypeColumn >= 0 && Number(cells[levelTypeColumn]) !== template) continue
      maxLevel = Math.max(maxLevel, Number(cells[levelAt] || 0))
    }
  }

  // The level curve lives in the server's database templates rather than a TSV here, so the
  // slider offers the game's ceiling and the server clamps to the curve it actually keeps.
  // A weapon belongs to a construct through Equip.Type matching Character.EquipType, which is how
  // the game decides which weapons a construct may carry at all.
  const equipTypeAt = characters.header.indexOf('EquipType')
  const equipType = Number(character[equipTypeAt] || 0)

  // Skill levels: the ceiling is what CharacterSkillUpgrade sells, 18 for a normal skill and 1 for a
  // passive. CharacterSkillLevelEffect runs higher (35) because those rows already include the levels
  // a built memory adds: six lower resonances add six on top of the bought 18, so the signature shows
  // 24 while its own level stays 18. The slider must offer the bought ceiling, not the effect one.
  let skillMax = 0
  let skillCount = 0
  const skillUpgrades = tableRows('share/character/skill/CharacterSkillUpgrade.tsv')
  const ownSkills = characterSkills(characterId)
  if (skillUpgrades && ownSkills && ownSkills.size > 0) {
    const upgradeSkillAt = skillUpgrades.header.indexOf('SkillId')
    const upgradeLevelAt = skillUpgrades.header.indexOf('Level')
    const caps = new Map()
    for (const cells of skillUpgrades.rows) {
      const skillId = Number(cells[upgradeSkillAt])
      if (!ownSkills.has(skillId)) continue
      caps.set(skillId, Math.max(caps.get(skillId) || 0, Number(cells[upgradeLevelAt] || 0)))
    }
    for (const cap of caps.values()) skillMax = Math.max(skillMax, cap)
    skillCount = caps.size
  }

  return { characterId, maxLevel: maxLevel || 80, stars, promotions, equipType, skillMax, skillCount }
}

// Which resonances a slot can hold, from the game's own pools: a memory takes a stat on slot 1
// and one of its construct's skills on slot 2, a weapon takes a class skill.
// A construct's own skills: its skill groups point at skill rows, and a memory's slot 2 may only
// offer those. Without this filter the pool hands the player another construct's kit.
function characterSkills(characterId) {
  const skills = tableRows('share/character/skill/CharacterSkill.tsv')
  const groups = tableRows('share/character/skill/CharacterSkillGroup.tsv')
  if (!skills || !groups || characterId <= 0) return null

  const whoAt = skills.header.indexOf('CharacterId')
  const groupIds = new Set()
  for (const cells of skills.rows) {
    if (Number(cells[whoAt]) !== characterId) continue
    for (let ordinal = 1; ordinal <= 16; ordinal += 1) {
      const at = skills.column('SkillGroupId', ordinal)
      if (at >= 0 && Number(cells[at] || 0) > 0) groupIds.add(Number(cells[at]))
    }
  }

  const idAt = groups.header.indexOf('Id')
  const kept = new Set()
  for (const cells of groups.rows) {
    if (!groupIds.has(Number(cells[idAt]))) continue
    for (let ordinal = 0; ordinal <= 2; ordinal += 1) {
      const at = groups.column('SkillId', ordinal)
      if (at >= 0 && Number(cells[at] || 0) > 0) kept.add(Number(cells[at]))
    }
  }
  return kept
}

// The construct's skill names are client-side text this server does not ship. Pool 1 (types 1-4)
// feeds the upper slot and pool 2 (types 5, 6, 7, 9) the lower one. The names come from the client's
// own resonance screen, the only place they exist: with 107501 on a memory the client reads "Red Orb
// Level +1", with 107516 it reads "Basic Attack Level +1", so the upper four run Red, Yellow, Blue,
// Basic in type order 1-4. Three runs, each read back from that screen, agreed with this and with no
// other reading; the type numbers alone would have said the opposite.
const SKILL_TYPE_LABELS = {
  1: 'Red Orb Level',
  2: 'Yellow Orb Level',
  3: 'Blue Orb Level',
  4: 'Basic Attack Level',
  5: 'Signature Move Level',
  6: 'QTE Level',
  7: 'Core Passive',
  9: 'Class Skill Level',
};

function skillTypeOf(skillId) {
  const types = tableRows('share/character/skill/CharacterSkillType.tsv')
  if (!types) return 0
  const idAt = types.header.indexOf('Id')
  const typeAt = types.header.indexOf('Type')
  const row = types.rows.find((cells) => Number(cells[idAt]) === skillId)
  return row ? Number(row[typeAt]) : 0

}

function skillTypeLabel(skillId) {
  const type = skillTypeOf(skillId)
  return SKILL_TYPE_LABELS[type] || ''
}

// The construct's class is a table column, not a judgement: Character.tsv carries Career, and
// CharacterCareer.tsv names it. Every resonance label follows from this.
function characterCareer(characterId) {
  const characters = tableRows('share/character/Character.tsv')
  const careers = tableRows('share/character/CharacterCareer.tsv')
  if (!characters || !careers || characterId <= 0) return ''

  const idAt = characters.header.indexOf('Id')
  const careerAt = characters.header.indexOf('Career')
  const typeAt = careers.header.indexOf('Type')
  const nameAt = careers.header.indexOf('Name')
  if (careerAt < 0) return ''

  const character = characters.rows.find((cells) => Number(cells[idAt]) === characterId)
  if (!character) return ''
  const career = careers.rows.find((cells) => Number(cells[typeAt]) === Number(character[careerAt] || 0))
  return career ? String(career[nameAt]).trim().toLowerCase() : ''
}

function resonanceEntries(templateId, slot, characterId) {
  const resonance = tableRows('share/equip/EquipResonance.tsv')
  if (!resonance) return null

  const idAt = resonance.header.indexOf('Id')
  const row = resonance.rows.find((cells) => Number(cells[idAt]) === templateId)
  if (!row) return []

  const equipTable = tableRows('share/equip/Equip.tsv')
  let site = -1
  if (equipTable) {
    const equipIdAt = equipTable.header.indexOf('Id')
    const siteAt = equipTable.header.indexOf('Site')
    const template = equipTable.rows.find((cells) => Number(cells[equipIdAt]) === templateId)
    if (template) site = Number(template[siteAt] || 0)
  }

  // Every weapon pool carries the same twelve resonance ids. Six of them are universal and keep
  // their name in every class; the rest are named per class, and the class comes from the shipped
  // resonance screens rather than from a table, so an unmapped construct keeps a neutral label
  // instead of a wrong one.
  // The game lists the twelve in the pool's own order, so the label follows the position rather
  // than the id: the first six carry the same name in every class, the rest are class business.
  // The first three of the twelve are named by frame kind, not by class: an Omniframe gets the
  // omniframe trio, a Uniframe the vanguard trio. The next three carry the same name everywhere.
  const WEAPON_UNIVERSAL_OMNI = ['Incandescence', 'Dead Line Timing', 'Matrix Lightning'];
  const WEAPON_UNIVERSAL_UNI = ['Matrix Outburst', 'Overload Signal', 'Limit Break'];
  const WEAPON_UNIVERSAL_TAIL = ['Shock Saturation', 'Nsec Transmission', 'Shock Echo'];
  const AMPLIFIER_SET = [
    'Glorious Spear',
    'Superconducting Axial Ray',
    'Honed Gel',
    'Stellar Magnetic Rail',
    'Peaceful Radiant',
  ];
  const TANK_SET = [
    'Resonant Echo',
    'Domain Deconstruction',
    "Boundary's Annihilation",
    'Gravity Barrier',
    'Absolute Defense',
  ];

  // Each class owns the block after the six universal entries, in the order the game shows it.
  // Attacker and Annihilator share one pick, Breaker is that pick plus the tank block, Observer
  // offers the amplifier block and then the tank block, and the three support classes are the same.
  const WEAPON_CLASS_NAMES = {
    attacker: ['Glorious Afterglow'],
    annihilator: ['Glorious Afterglow'],
    breaker: ['Glorious Afterglow', ...TANK_SET],
    tank: TANK_SET,
    support: AMPLIFIER_SET,
    amplifier: AMPLIFIER_SET,
    overlinker: AMPLIFIER_SET,
    observer: [...AMPLIFIER_SET, ...TANK_SET],
  };

  // A weapon resonates from its class skill pool on all three slots.
  if (site === 0) {
    const poolId = Number(row[resonance.column('WeaponSkillPoolId', slot)] || 0)
    const pools = tableRows('share/equip/WeaponSkillPool.tsv')
    if (poolId <= 0 || !pools) return []
    const poolAt = pools.header.indexOf('PoolId')
    const classAt = pools.header.indexOf('CharacterId')
    const entries = []
    const seen = new Set()
    for (const cells of pools.rows) {
      if (Number(cells[poolAt]) !== poolId) continue
      if (characterId > 0 && Number(cells[classAt]) !== characterId) continue
      for (let ordinal = 1; ordinal <= 16; ordinal += 1) {
        const at = pools.column('SkillId', ordinal)
        const skillId = at >= 0 ? Number(cells[at] || 0) : 0
        if (skillId <= 0 || seen.has(skillId)) continue
        seen.add(skillId)
        const career = characterCareer(characterId);
        const head = career === 'vanguard' ? WEAPON_UNIVERSAL_UNI : WEAPON_UNIVERSAL_OMNI;
        const universal = [...head, ...WEAPON_UNIVERSAL_TAIL];
        const classNames = WEAPON_CLASS_NAMES[career] || [];
        const name = universal[entries.length] || classNames[entries.length - universal.length] || 'Class Resonance';
        entries.push({ kind: 'weapon', id: skillId, name: name, meta: '' })
      }
    }
    return entries
  }

  // Both memory slots offer the same four stat picks. What differs is the skill list: the upper slot
  // carries the basic attack and the three orb levels, the lower slot the signature, QTE, core passive
  // and class skill. The tables split it by skill type, 1-4 against 5/6/7/9.
  const attribPoolId = Number(row[resonance.column('AttribPoolId', slot)] || 0)
  const wantedTypes = slot === 1 ? [1, 2, 3, 4] : [5, 6, 7, 9]
  // The client lists the skills of a resonance list first and the stat picks after them, so a picker
  // reads like the screen: the four skills, then the four stat picks. The skill order inside a tab is
  // plain type order, which after the labels above reads Red, Yellow, Blue, Basic.
  const skillOrder = slot === 1 ? [1, 2, 3, 4] : [5, 6, 7, 9]
  const entries = []

  if (attribPoolId > 0) {
    const attribs = tableRows('share/attrib/AttribPool.tsv')
    if (attribs) {
      const poolAt = attribs.header.indexOf('PoolId')
      const idIndex = attribs.header.indexOf('Id')
      const nameIndex = attribs.header.indexOf('Name')
      const descIndex = attribs.header.indexOf('Description')
      for (const cells of attribs.rows) {
        if (Number(cells[poolAt]) !== attribPoolId) continue
        // The client names a stat by its effect and nothing else: "HP +75, ATK +15". The pool's own
        // name ("Ex - Tactical Adjustment") never appears on that screen, so it is dropped here too,
        // out of the label and out of any tip.
        entries.push({
          kind: 'attrib',
          id: Number(cells[idIndex]),
          name: (cells[descIndex] || '').trim() || (cells[nameIndex] || '').trim() || 'Stat',
          meta: '',
          order: 50,
        })
      }
    }
  }

  const allowed = characterSkills(characterId)
  const pools = tableRows('share/character/skill/CharacterSkillPool.tsv')
  const seen = new Set()
  if (pools) {
    const poolAt = pools.header.indexOf('PoolId')
    const skillAt = pools.header.indexOf('SkillId')
    const poolIds = new Set([0, 1].map((index) => Number(row[resonance.column('CharacterSkillPoolId', index + 1)] || 0)))
    for (const cells of pools.rows) {
      if (!poolIds.has(Number(cells[poolAt]))) continue
      const skillId = Number(cells[skillAt] || 0)
      if (skillId <= 0 || seen.has(skillId)) continue
      if (allowed !== null && allowed.size > 0 && !allowed.has(skillId)) continue
      const type = skillTypeOf(skillId)
      if (!wantedTypes.includes(type)) continue
      seen.add(skillId)
      const rank = skillOrder.indexOf(type)
      entries.push({ kind: 'skill', id: skillId, name: SKILL_TYPE_LABELS[type] || 'Skill', meta: '', order: rank < 0 ? 40 : rank })
    }
  }

  entries.sort((left, right) => left.order - right.order)
  return entries
}

function catalog(kind) {
  const source = catalogSources[kind]
  if (!source) return null
  const file = path.join(config.tableDir, ...source.file.split('/'))
  if (!fs.existsSync(file)) return null
  return parseTsv(file, source.id, source.name, source.extra, source.owner, source.owner ? 0 : undefined, Boolean(source.invert), source.slot)
}

// Every memory set is six entries sharing a SuitId, one per slot. Slot layouts differ
// per construct, so the panel grants the whole set and the player picks which four to equip.
function memorySets() {
  const file = path.join(config.tableDir, 'share', 'equip', 'Equip.tsv')
  if (!fs.existsSync(file)) return null

  const stat = fs.statSync(file)
  const hit = cache.get('memory-sets')
  if (hit && hit.stamp === stat.mtimeMs) return hit.sets

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase())
  const col = (name) => header.indexOf(name.toLowerCase())
  const idAt = col('Id'), siteAt = col('Site'), suitAt = col('SuitId'), nameAt = col('Name'), starAt = col('Star')
  if ([idAt, siteAt, suitAt, nameAt].some((i) => i < 0)) return []

  const bySuit = new Map()
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i].split('\t')
    const site = Number((row[siteAt] || '').trim())
    if (!Number.isFinite(site) || site < 1 || site > 6) continue

    const suitId = Number((row[suitAt] || '').trim())
    const id = Number((row[idAt] || '').trim())
    if (!Number.isFinite(suitId) || !Number.isFinite(id)) continue

    if (!bySuit.has(suitId)) bySuit.set(suitId, { id: suitId, name: (row[nameAt] || '').trim(), star: (row[starAt] || '').trim(), slots: [] })
    bySuit.get(suitId).slots.push({ site, id })
  }

  const sets = [...bySuit.values()]
    .filter((set) => set.slots.length === 6)
    .map((set) => ({ id: set.id, name: set.name, star: set.star, meta: `${set.star}★ · 6 memories`, slots: set.slots.sort((a, b) => a.site - b.site) }))
    .sort((a, b) => a.name.localeCompare(b.name) || b.id - a.id)

  cache.set('memory-sets', { stamp: stat.mtimeMs, sets })
  return sets
}

function coatings(characterId) {
  const file = path.join(config.tableDir, 'share', 'fashion', 'Fashion.tsv')
  if (!fs.existsSync(file)) return null

  const stat = fs.statSync(file)
  const key = `fashion:${characterId}`
  const hit = cache.get(key)
  if (hit && hit.stamp === stat.mtimeMs) return hit.entries

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const header = lines[0].split('\t').map((h) => h.trim())
  const at = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const idIndex = at('Id')
  const nameIndex = at('Name')
  const ownerIndex = at('CharacterId')
  const qualityIndex = at('Quality')
  if (idIndex < 0 || nameIndex < 0 || ownerIndex < 0) return []

  const entries = []
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i].split('\t')
    if (Number(row[ownerIndex]) !== Number(characterId)) continue
    const name = (row[nameIndex] || '').trim()
    if (!name) continue
    const quality = qualityIndex >= 0 ? (row[qualityIndex] || '').trim() : ''
    entries.push({ id: Number(row[idIndex]), name, meta: quality ? `tier ${quality}` : '' })
  }

  cache.set(key, { stamp: stat.mtimeMs, entries })
  return entries
}

// ---------------------------------------------------------------- ui server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// The admin token lives beside the server build; both panel proxies below inject it so the
// pages never hold it.
function readAdminToken() {
  const file = path.join(config.serverDir || '', 'admin-token.txt')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null
}

function sendJson(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
  res.end(body)
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return
  }
  // no-store: these files are edited while the app runs, and a cached stylesheet silently
  // kept an older layout alive through several rounds of fixes.
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(file).pipe(res)
}

function proxy(req, res, url) {
  const target = `http://127.0.0.1:${config.sdkPort}${url}`
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${config.sdkPort}` } }, (response) => {
    res.writeHead(response.statusCode || 502, response.headers)
    response.pipe(res)
  })
  upstream.on('error', (err) => sendJson(res, { msg: `SDK server unreachable: ${err.message}` }, 502))
  req.pipe(upstream)
}

function startUiServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')

      if (url.pathname === '/api/panel/memory-sets') {
        const sets = memorySets()
        if (!sets) return sendJson(res, { code: -1, msg: 'memory table not found' }, 404)
        return sendJson(res, { code: 0, sets })
      }

      if (url.pathname === '/api/panel/accounts') {
        const token = readAdminToken()
        if (!token) return sendJson(res, { code: -1, msg: 'admin token not found - start the server once' }, 404)
        fetch('http://127.0.0.1:' + config.sdkPort + '/api/admin/accounts', { headers: { 'X-Admin-Token': token } })
          .then((r) => r.json().then((body) => sendJson(res, body, r.status)))
          .catch((err) => sendJson(res, { code: -1, msg: err.message }, 502))
        return
      }

      // The player panel picks an account from the database instead of signing in, so it runs
      // commands through the admin channel; the token stays in the main process.
      if (url.pathname.startsWith('/api/panel/command/')) {
        const token = readAdminToken()
        if (!token) return sendJson(res, { ok: false, msg: 'admin token not found - start the server once' }, 404)

        const name = url.pathname.slice('/api/panel/command/'.length)
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          fetch('http://127.0.0.1:' + config.sdkPort + '/api/admin/command/' + encodeURIComponent(name), {
            method: 'POST',
            headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
            body: body || '{}',
          })
            .then((response) => response.json().then((payload) => sendJson(res, payload, response.status)))
            .catch((err) => sendJson(res, { ok: false, msg: err.message }, 502))
        })
        return
      }

      if (url.pathname === '/api/panel/tune-catalog') {
        const catalog = tuneCatalog()
        return catalog
          ? sendJson(res, Object.assign({ ok: true }, catalog))
          : sendJson(res, { ok: false, msg: 'character tables not found' }, 404)
      }

      if (url.pathname.startsWith('/api/panel/tune-character/')) {
        const characterId = Number(url.pathname.slice('/api/panel/tune-character/'.length))
        const detail = tuneCharacter(characterId)
        return detail
          ? sendJson(res, Object.assign({ ok: true }, detail))
          : sendJson(res, { ok: false, msg: 'construct ' + characterId + ' has no table row' }, 404)
      }

      if (url.pathname === '/api/panel/tune-bulk') {
        const token = readAdminToken()
        if (!token) return sendJson(res, { ok: false, msg: 'admin token not found - start the server once' }, 404)

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          fetch('http://127.0.0.1:' + config.sdkPort + '/api/admin/tune-bulk', {
            method: 'POST',
            headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
            body: body || '{}',
          })
            .then((response) => response.json().then((payload) => sendJson(res, payload, response.status)))
            .catch((err) => sendJson(res, { ok: false, msg: err.message }, 502))
        })
        return
      }

      if (url.pathname === '/api/panel/tune') {
        const token = readAdminToken()
        if (!token) return sendJson(res, { ok: false, msg: 'admin token not found - start the server once' }, 404)

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          fetch('http://127.0.0.1:' + config.sdkPort + '/api/admin/tune', {
            method: 'POST',
            headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
            body: body || '{}',
          })
            .then((response) => response.json().then((payload) => sendJson(res, payload, response.status)))
            .catch((err) => sendJson(res, { ok: false, msg: err.message }, 502))
        })
        return
      }

      if (url.pathname.startsWith('/api/panel/resonance/')) {
        const parts = url.pathname.split('/')
        const templateId = Number(parts[4])
        const slot = Number(parts[5])
        const characterId = Number(url.searchParams.get('character') || 0)
        const entries = resonanceEntries(templateId, slot, characterId)
        if (entries === null) return sendJson(res, { code: -1, msg: 'resonance tables not found' }, 404)
        // A memory written by an older mapping can hold a resonance this slot no longer offers. Echo it
        // back under its own name so the picker shows what is stored instead of "nothing to pick", and
        // the player can see it and choose again.
        const storedId = Number(url.searchParams.get('include') || 0)
        if (storedId > 0 && !entries.some((entry) => entry.id === storedId)) {
          const storedType = skillTypeOf(storedId)
          if (storedType > 0) {
            entries.push({ kind: 'skill', id: storedId, name: SKILL_TYPE_LABELS[storedType] || 'Skill', meta: 'stored on this slot', order: 99 })
          } else {
            const attribs = tableRows('share/attrib/AttribPool.tsv')
            let name = 'Stored resonance'
            if (attribs) {
              const idIndex = attribs.header.indexOf('Id')
              const nameIndex = attribs.header.indexOf('Name')
              const descIndex = attribs.header.indexOf('Description')
              const found = attribs.rows.find((cells) => Number(cells[idIndex]) === storedId)
              if (found) name = (found[descIndex] || '').trim() || (found[nameIndex] || '').trim() || name
            }
            entries.push({ kind: 'attrib', id: storedId, name, meta: 'stored on this slot', order: 99 })
          }
        }
        // The pool alone is not enough: without a select item row the server refuses the request,
        // so the panel says so instead of offering a button that cannot work.
        const useItems = tableRows('share/equip/EquipResonanceUseItem.tsv')
        let selectItemId = 0
        let selectItemCount = 0
        if (useItems) {
          const idAt = useItems.header.indexOf('Id')
          const itemAt = useItems.column('SelectSkillItemId', 1)
          const countAt = useItems.column('SelectSkillItemCount', 1)
          const row = useItems.rows.find((cells) => Number(cells[idAt]) === templateId)
          if (row) {
            selectItemId = itemAt >= 0 ? Number(row[itemAt] || 0) : 0
            selectItemCount = countAt >= 0 ? Number(row[countAt] || 0) : 0
          }
        }
        return sendJson(res, { code: 0, templateId, slot, count: entries.length, selectItemId, selectItemCount, entries })
      }

      if (url.pathname.startsWith('/api/panel/catalog/')) {
        const kind = url.pathname.split('/').pop()
        const entries = catalog(kind)
        if (!entries) return sendJson(res, { code: -1, kind, msg: 'unknown or missing catalog' }, 404)
        return sendJson(res, { code: 0, kind, count: entries.length, entries })
      }

      if (url.pathname.startsWith('/api/panel/coatings/')) {
        const characterId = Number(url.pathname.split('/').pop())
        const entries = coatings(characterId) || []
        return sendJson(res, { code: 0, characterId, count: entries.length, entries })
      }

      // A shell that reloads itself when its own files change: a reload with focus inside the panel
      // frame left the outer document showing an older header, and the only cure was guessing at Ctrl+R.
      if (url.pathname === '/api/panel/shell-version') {
        const files = [
          path.join(__dirname, 'ui', 'index.html'),
          path.join(__dirname, 'ui', 'app.js'),
          path.join(__dirname, 'ui', 'style.css'),
          path.join(config.webUi, 'common', 'theme.css'),
        ]
        const stamp = files.map((file) => {
          try {
            const stat = fs.statSync(file)
            return `${path.basename(file)}:${stat.mtimeMs}:${stat.size}`
          } catch {
            return `${path.basename(file)}:missing`
          }
        }).join('|')
        return sendJson(res, { ok: true, stamp })
      }

      if (url.pathname.startsWith('/api/')) return proxy(req, res, req.url)

      // The shell page lives beside main.js; the panels live in the repo's web-ui.
      const requestPath = url.pathname === '/' ? '/ui/index.html' : url.pathname
      const safe = (value) => path.normalize(value).replace(/^(\.\.[/\\])+/, '')
      const file = requestPath.startsWith('/ui/')
        ? path.join(__dirname, 'ui', safe(requestPath.slice('/ui/'.length)))
        : path.join(config.webUi, safe(requestPath))
      serveFile(res, file)
    })

    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}


// ---------------------------------------------------------------- settings & tools

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
const SETTINGS_KEYS = ['gameDir', 'serverDir', 'mongoBinary', 'mongoDataDir', 'repo', 'repoUrl', 'repoRoot']

function settingsSnapshot() {
  return {
    ...Object.fromEntries(SETTINGS_KEYS.map((key) => [key, config[key]])),
    mongoExists: Boolean(config.mongoBinary && fs.existsSync(config.mongoBinary)),
    mongoDir: config.mongoBinary ? path.dirname(config.mongoBinary) : path.join(app.getPath('userData'), 'mongo'),
    mongoDataDir: mongoDataPath(),
    logsDir: logDir,
    repoRoot: config.repoRoot,
    repoUrl: config.repoUrl,
    repoCloned: Boolean(config.repoRoot && fs.existsSync(path.join(config.repoRoot, 'AscNet', 'AscNet.csproj'))),
    serverExists: Boolean(config.serverDir && fs.existsSync(path.join(config.serverDir, 'AscNet.dll'))),
    sdkPort: config.sdkPort,
    packaged: app.isPackaged,
  }
}

function persistSettings(next) {
  for (const key of SETTINGS_KEYS) {
    if (next[key] !== undefined) config[key] = next[key]
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(Object.fromEntries(SETTINGS_KEYS.map((k) => [k, config[k]])), null, 2))
  return settingsSnapshot()
}

async function browsePath(key, current) {
  const { dialog } = require('electron')
  const wantsFile = key === 'mongoBinary'
  const result = await dialog.showOpenDialog({
    title: wantsFile ? 'Select mongod.exe' : 'Select folder',
    defaultPath: current || undefined,
    properties: wantsFile ? ['openFile'] : ['openDirectory'],
    filters: wantsFile ? [{ name: 'Executable', extensions: ['exe'] }] : undefined,
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

function download(url, target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'))
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        return download(response.headers.location, target, redirects + 1).then(resolve, reject)
      }
      if (response.statusCode !== 200) {
        response.resume()
        return reject(new Error(`download failed with HTTP ${response.statusCode}`))
      }
      const out = fs.createWriteStream(target)
      response.pipe(out)
      out.on('finish', () => out.close(() => resolve(target)))
      out.on('error', reject)
    }).on('error', reject)
  })
}

function extractZip(zip, destination) {
  return new Promise((resolve, reject) => {
    // tar.exe ships with Windows and handles long paths; PowerShell's Expand-Archive
    // treats some failures as non-terminating and would hand back a partial tree.
    const tar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe')
    const child = spawn(tar, ['-xf', zip, '-C', destination], { windowsHide: true })
    let error = ''
    child.stderr.on('data', (chunk) => { error += chunk.toString() })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(error || `tar exited with ${code}`))))
  })
}

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name) return full
    if (entry.isDirectory()) {
      const hit = findFile(full, name)
      if (hit) return hit
    }
  }
  return null
}

const MONGO_ZIP = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.48.zip'

async function installMongo() {
  const base = config.mongoBinary
    ? path.dirname(config.mongoBinary)
    : path.join(app.getPath('userData'), 'mongo')

  fs.mkdirSync(base, { recursive: true })
  const zip = path.join(base, 'mongodb.zip')

  log(`downloading MongoDB to ${base}`)
  await download(MONGO_ZIP, zip)
  log('extracting MongoDB')
  await extractZip(zip, base)

  const mongod = findFile(base, 'mongod.exe')
  if (!mongod) throw new Error('mongod.exe was not found in the downloaded archive')

  config.mongoBinary = mongod
  persistSettings({ mongoBinary: mongod })
  log(`mongod ready at ${mongod}`)
  return { mongoBinary: mongod }
}


// Cloning is the first thing a non-programmer needs: the build button cannot work
// until the source exists, and "find it on GitHub" is not an instruction they can
// follow. The clone lands in repoRoot, which the build then uses.
function cloneRepo(url) {
  if (!url) throw new Error('enter the repository URL first')
  const target = config.repoRoot || path.join(app.getPath('userData'), 'repo')

  if (fs.existsSync(path.join(target, 'AscNet', 'AscNet.csproj'))) {
    log('repository already cloned')
    return { ok: true, already: true, target }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  log(`cloning ${url} into ${target}`)

  return new Promise((resolve, reject) => {
    const child = spawnHidden('git', ['clone', '--depth', '1', url, target], {})
    child.on('error', () => reject(new Error('git was not found; install Git or clone the repository manually')))
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`git clone exited with ${code}`))
      config.repoRoot = target
      persistSettings({ repoRoot: target, repoUrl: url })
      log('repository cloned')
      resolve({ ok: true, target })
    })
  })
}

const backupRoot = path.join(app.getPath('userData'), 'backups')

async function backupNow(reason) {
  // mongod keeps its files locked, so the snapshot is taken with the stack down and
  // the previous running state restored afterwards.
  const wasRunning = await portOpen(config.mongoPort)
  if (wasRunning) {
    // stopStackFor, not stopAll: a stack started from tools/ is not this app's child, and
    // copying a locked database fails with EDOM.
    if (!(await stopStackFor())) throw new Error('the stack is still running - stop it before backing up')
    log('database stopped for the snapshot')
  }

  let result
  try {
    result = createBackup({
      dataDir: mongoDataPath(),
      configsDir: path.join(config.serverDir || '', 'Configs'),
      backupRoot,
      reason,
    })
    log(`backup written to ${result}`)
  } finally {
    if (wasRunning) {
      await startAll()
      log('database started again')
    }
  }

  return { path: result, backups: listBackups(backupRoot) }
}

// ---------------------------------------------------------------- build and update

// The build writes over the dlls the running server has loaded, so every build path has to
// take the stack down first; otherwise dotnet retries MSB3026/MSB3021 and gives up.
function buildServer() {
  const project = path.join(config.repoRoot || path.join(__dirname, '..'), 'AscNet', 'AscNet.csproj')
  if (!fs.existsSync(project)) throw new Error(`project not found: ${project}`)

  const root = dotnetRoot()
  const dotnet = root ? path.join(root, 'dotnet.exe') : 'dotnet'
  return new Promise((resolve, reject) => {
    const child = spawnHidden(dotnet, ['build', project, '-v', 'q', '--nologo'], { cwd: path.dirname(path.dirname(project)) })
    child.on('error', () => reject(new Error('dotnet was not found; install the .NET 8 SDK or build manually')))
    child.on('exit', (code) => resolve({ ok: code === 0 }))
  })
}

// This app only owns the processes it spawned itself. A stack started from tools/ belongs to
// the control centre, and the port - not the child list - is what tells us it is gone.
async function stopStackFor(seconds = 25) {
  const listening = async () => (await portOpen(config.sdkPort)) || (await portOpen(config.mongoPort))

  await stopAll()

  if (await listening()) {
    const script = path.join(config.repoRoot || path.join(__dirname, '..'), 'tools', 'SelenaPort-ControlCenter.ps1')
    if (fs.existsSync(script)) {
      await new Promise((resolve) => {
        const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'stop'], { windowsHide: true, stdio: 'ignore' })
        child.on('error', resolve)
        child.on('exit', resolve)
      })
      log('stack stopped through the control centre')
    }
  }

  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline && await listening())
    await new Promise((resolve) => setTimeout(resolve, 500))

  return !(await listening())
}

async function rebuildServer() {
  // Snapshot first: a rebuild that goes wrong should cost time, not data.
  // The IPC layer awaits this; a failed snapshot must not stop the build.
  await backupNow('rebuild').catch((err) => log(`backup skipped: ${err.message}`))

  if (!(await stopStackFor())) {
    log('the server is still listening after a stop request; the build would hit its own files')
    return { ok: false, reason: 'the server is still listening - stop the stack, then build again' }
  }

  const result = await buildServer()
  await startAll().catch((err) => log(`restart failed: ${err.message}`))
  return result
}

function checkUpdate(repo) {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/commits?per_page=1`
    https.get(url, { headers: { 'User-Agent': 'selena-port', Accept: 'application/vnd.github+json' } }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`GitHub answered ${response.statusCode}`))
        try {
          const commits = JSON.parse(body)
          if (!Array.isArray(commits) || commits.length === 0) return reject(new Error('no commits returned'))
          resolve({
            sha: commits[0].sha.slice(0, 10),
            full: commits[0].sha,
            message: commits[0].commit.message.split('\n')[0],
            date: commits[0].commit.committer.date,
          })
        } catch (err) {
          reject(new Error('could not read the response'))
        }
      })
    }).on('error', reject)
  })
}

// Git answers for the update tab. A spawn that fails is a result, not an exception, so the
// caller can report which step failed instead of a stack trace.
function gitCapture(root, args) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', root, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', () => resolve({ code: -1, stdout: '', stderr: 'git was not found; install Git to update from here' }))
    child.on('exit', (code) => resolve({ code, stdout: out.trim(), stderr: err.trim() }))
  })
}

// What the update tab shows: the local HEAD and branch, whether the tree is clean, and where
// the tracked GitHub repository stands. Update is offered only when the two differ and the
// tree is clean, because the pull is fast-forward only.
async function updateStatus(repo) {
  const root = config.repoRoot
  if (!root || !fs.existsSync(path.join(root, 'AscNet', 'AscNet.csproj')))
    return { ok: false, canUpdate: false, reason: 'the repository is not cloned - clone it from Configuration first' }

  const head = await gitCapture(root, ['rev-parse', 'HEAD'])
  if (head.code !== 0)
    return { ok: false, canUpdate: false, reason: head.stderr || 'git could not read HEAD' }

  const branch = await gitCapture(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const dirty = await gitCapture(root, ['status', '--porcelain'])

  let remote = null
  let remoteError = null
  if (repo) {
    try {
      const commit = await checkUpdate(repo)
      remote = { sha: commit.sha, full: commit.full, message: commit.message, date: commit.date }
    } catch (err) {
      remoteError = err.message
    }
  } else {
    remoteError = 'enter owner/name first'
  }

  const upToDate = Boolean(remote && remote.full === head.stdout)
  return {
    ok: true,
    local: { sha: head.stdout.slice(0, 10), full: head.stdout, branch: branch.stdout },
    remote,
    remoteError,
    dirty: dirty.stdout.length > 0,
    dirtyFiles: dirty.stdout ? dirty.stdout.split('\n').length : 0,
    upToDate,
    canUpdate: Boolean(remote && !upToDate && !dirty.stdout),
  }
}

// Apply means: snapshot, stop the stack, pull fast-forward only, build, start again. Each
// step is reported, so a failure names the step instead of "update failed".
async function applyUpdate() {
  const steps = []
  const finish = (ok) => ({ ok, steps })
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail: detail || '' })
    log(`[update] ${name}: ${ok ? 'ok' : 'failed'}${detail ? ' - ' + detail : ''}`)
  }

  const root = config.repoRoot
  if (!root || !fs.existsSync(path.join(root, 'AscNet', 'AscNet.csproj'))) {
    step('repository', false, 'not cloned')
    return finish(false)
  }

  const dirty = await gitCapture(root, ['status', '--porcelain'])
  if (dirty.code !== 0) {
    step('working tree', false, dirty.stderr)
    return finish(false)
  }
  if (dirty.stdout) {
    step('working tree', false, 'local changes; commit or discard them first')
    return finish(false)
  }
  step('working tree', true, 'clean')

  const branch = await gitCapture(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  step('branch', branch.code === 0, branch.stdout)

  try {
    const backup = await backupNow('update')
    step('backup', true, backup.path)
  } catch (err) {
    step('backup', false, err.message)
    return finish(false)
  }

  if (!(await stopStackFor())) {
    step('stack', false, 'still listening after a stop request')
    return finish(false)
  }
  step('stack', true, 'stopped')

  const pull = await gitCapture(root, ['pull', '--ff-only'])
  if (pull.code !== 0) {
    step('pull', false, pull.stderr || `git pull exited with ${pull.code}`)
    await startAll().catch((err) => log(`restart failed: ${err.message}`))
    return finish(false)
  }
  step('pull', true, pull.stdout.split('\n').filter(Boolean).pop() || 'already up to date')

  let build
  try {
    build = await buildServer()
  } catch (err) {
    step('build', false, err.message)
    await startAll().catch((restartError) => log(`restart failed: ${restartError.message}`))
    return finish(false)
  }
  if (!build.ok) {
    step('build', false, 'dotnet build failed; the log has the compiler output')
    await startAll().catch((err) => log(`restart failed: ${err.message}`))
    return finish(false)
  }
  step('build', true, '')

  try {
    const started = await startAll()
    step('restart', Boolean(started.sdk), started.sdk ? `server listening on ${started.sdkPort}` : 'server did not come up')
  } catch (err) {
    step('restart', false, err.message)
  }

  return finish(steps.every((entry) => entry.ok))
}

// ---------------------------------------------------------------- window

let mainWindow = null
let uiPort = 0

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0c0e16',
    autoHideMenuBar: true,
    title: 'Selena-port',
    icon: path.join(__dirname, '..', 'web-ui', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await mainWindow.loadURL(`http://127.0.0.1:${uiPort}/ui/index.html`)
  mainWindow.on('closed', () => { mainWindow = null })

  watchRenderer()
}

// ---------------------------------------------------------------- hot reload

let reloadTimer = null

function reloadRenderer(reason, shellChanged) {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (shellChanged) {
      // A shell edit needs a fresh page; the stored view brings the user back to the same tab.
      mainWindow.webContents.reloadIgnoringCache()
    } else {
      // A panel edit only needs the frames reloaded, which leaves the shell and its tab alone.
      mainWindow.webContents.executeJavaScript(
        "document.querySelectorAll('iframe').forEach((frame) => { if (frame.src) frame.src = frame.src })",
        true,
      ).catch(() => {})
    }
    console.log(`[dev] reloaded: ${reason}`)
  }, 180)
}

function watchRenderer() {
  if (!isDev) return

  const watched = [path.join(__dirname, 'ui'), config.webUi, path.join(__dirname, '..', 'web-ui', 'common')]
  const seen = new Set()

  for (const dir of watched) {
    if (!fs.existsSync(dir) || seen.has(dir)) continue
    seen.add(dir)
    try {
      fs.watch(dir, { recursive: true }, (_event, file) => {
        if (file && /[\\/](node_modules|release|runtime)[\\/]/.test(String(file))) return
        reloadRenderer(`${path.basename(dir)}/${file || 'change'}`, dir === path.join(__dirname, 'ui'))
      })
    } catch (error) {
      console.log(`[dev] cannot watch ${dir}: ${error.message}`)
    }
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault() }
    if (input.key === 'r' && (input.control || input.meta)) { reloadRenderer('manual'); event.preventDefault() }
  })

  console.log(`[dev] watching ${[...seen].join(', ')} - save a file to reload, F12 for devtools`)
}

app.whenReady().then(async () => {
  // Only the instance that owns the lock starts a server or opens a window.
  if (!singleInstance) return
  fs.mkdirSync(logDir, { recursive: true })

  // A player installs through Steam and never learns the folder name: fill it in rather than sending them
  // to a Browse dialog first. A configured folder that no longer holds PGR.exe is replaced the same way.
  if (!config.gameDir || !fs.existsSync(path.join(config.gameDir, 'PGR.exe'))) {
    const detected = detectGameDir(config, log)
    if (detected) {
      config.gameDir = detected
      persistSettings({ gameDir: detected })
      log(`game directory found at ${detected}`)
    }
  }

  uiPort = await startUiServer()
  // Persist the port: it is ephemeral, and the smoke test (and any support request)
  // needs to know where the shell is actually listening.
  fs.writeFileSync(path.join(logDir, 'ui-port.txt'), String(uiPort))
  log(`ui served on http://127.0.0.1:${uiPort}`)

  // Handlers must exist before the window loads, or the page's first calls race the
  // registration and fail with "No handler registered".
  ipcMain.handle('stack:status', () => status())
  // Two clicks, or a click while the first start is still waiting on a port, must not spawn twice.
  let starting = null
  ipcMain.handle('stack:start', () => {
    if (!starting) starting = startAll().finally(() => { starting = null })
    return starting
  })
  // The Stop button goes through the same path the build and backup use: this app only owns the
  // children it spawned, and a stack started from tools/ belongs to the control centre, so a stop
  // that only kills our own list leaves the server listening and the button doing nothing.
  ipcMain.handle('stack:stop', () => stopStackFor().then(() => status()))
  ipcMain.handle('stack:launch', () => { launchClient(); return true })
  ipcMain.handle('stack:logs', () => logLines)
  ipcMain.handle('stack:config', () => ({ uiPort, sdkPort: config.sdkPort, gameDir: config.gameDir }))
  ipcMain.handle('config:get', () => settingsSnapshot())
  ipcMain.handle('config:set', (_event, next) => persistSettings(next || {}))
  ipcMain.handle('config:browse', (_event, payload) => browsePath(payload.key, payload.current))
  ipcMain.handle('tools:install-mongo', () => installMongo())
  ipcMain.handle('tools:rebuild', () => rebuildServer())
  ipcMain.handle('update:check', (_event, repo) => checkUpdate(repo))
  ipcMain.handle('update:status', (_event, repo) => updateStatus(repo))
  ipcMain.handle('update:apply', () => applyUpdate())
  ipcMain.handle('tools:clone', (_event, url) => cloneRepo(url))
  ipcMain.handle('shell:logs', () => shell.openPath(logDir))
  ipcMain.handle('setup:verify', () => buildChecks(config))
  ipcMain.handle('admin:token', () => {
    // The server generates it beside its build; reading it here keeps the token out of
    // the page and out of any URL.
    const file = path.join(config.serverDir || '', 'admin-token.txt')
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
  })
  ipcMain.handle('tools:backup', () => backupNow('manual'))
  ipcMain.handle('tools:open-backups', () => shell.openPath(backupRoot))
  ipcMain.handle('stack:open', (_event, target) => shell.openExternal(target))

  await createWindow()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', async () => {
  // In development the stack outlives this window: the server and the game client were started
  // separately, and closing the console must not take them down.
  if (!isDev) await stopAll()
  app.quit()
})

app.on('before-quit', () => {
  if (isDev) return
  for (const key of ['server', 'mongo']) {
    const child = running[key]
    if (child && !child.killed) child.kill()
  }
})