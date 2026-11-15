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
const { spawn } = require('child_process')
const { buildChecks } = require('./verify')
const { createBackup, listBackups } = require('./backup')

// ---------------------------------------------------------------- settings

const isPackaged = app.isPackaged
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
  gameDir: isPackaged ? '' : 'D:\\gemink\\Punishing Gray Raven\\Punishing Gray Raven Game',
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

async function status() {
  return {
    mongo: await portOpen(config.mongoPort),
    sdk: await portOpen(config.sdkPort),
    game: await portOpen(config.gamePort),
    mongoPort: config.mongoPort,
    sdkPort: config.sdkPort,
    gamePort: config.gamePort,
    gameDir: config.gameDir,
    serverDir: config.serverDir,
  }
}

function spawnHidden(file, args, options) {
  const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  child.stdout.on('data', (chunk) => log(chunk.toString().trim()))
  child.stderr.on('data', (chunk) => log(chunk.toString().trim()))
  child.on('exit', (code) => log(`${path.basename(file)} exited with ${code}`))
  return child
}

async function startMongo() {
  if (await portOpen(config.mongoPort)) { log('mongod already listening'); return }
  if (!fs.existsSync(config.mongoBinary)) throw new Error(`mongod not found at ${config.mongoBinary}`)

  const mongoDataDir = mongoDataPath()
  fs.mkdirSync(mongoDataDir, { recursive: true })
  running.mongo = spawnHidden(config.mongoBinary, [
    '--dbpath', mongoDataDir,
    '--port', String(config.mongoPort),
    '--bind_ip', '127.0.0.1',
    '--logpath', path.join(logDir, 'mongod.log'),
    '--logappend',
  ], { cwd: mongoDataDir })

  if (!(await waitPort(config.mongoPort, 60))) throw new Error('mongod did not start listening')
  log('mongod ready')
}

async function startServer() {
  if (await portOpen(config.sdkPort)) { log('server already listening'); return }

  const exe = path.join(config.serverDir, 'AscNet.exe')
  const dll = path.join(config.serverDir, 'AscNet.dll')
  let child

  if (fs.existsSync(exe) && process.env.SELENA_FORCE_DLL !== '1') {
    child = spawnHidden(exe, ['--urls', `http://127.0.0.1:${config.sdkPort}`], { cwd: config.serverDir })
  } else if (fs.existsSync(dll)) {
    const dotnet = process.env.DOTNET_ROOT
      ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe')
      : 'dotnet'
    child = spawnHidden(dotnet, ['AscNet.dll', '--urls', `http://127.0.0.1:${config.sdkPort}`], { cwd: config.serverDir })
  } else {
    throw new Error(`server build not found in ${config.serverDir}`)
  }

  running.server = child
  if (!(await waitPort(config.sdkPort, 120))) throw new Error('server did not start listening')
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
  memories: { file: 'share/equip/Equip.tsv', id: 'Id', name: 'Name', extra: 'Star', owner: 'WeaponSkillId' },
  stages: { file: 'share/fuben/Stage.tsv', id: 'StageId', name: 'Name', extra: null },
  scenes: { file: 'share/photomode/Background.tsv', id: 'Id', name: 'Name', extra: 'Quality' },
}

const cache = new Map()

function parseTsv(file, idColumn, nameColumn, extraColumn, ownerColumn, filterOwner, invertOwner = false) {
  const stat = fs.statSync(file)
  const key = `${file}:${ownerColumn || ''}:${filterOwner || ''}:${invertOwner}`
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

    entries.push({ id, name, meta })
  }

  cache.set(key, { stamp: stat.mtimeMs, entries })
  return entries
}

function catalog(kind) {
  const source = catalogSources[kind]
  if (!source) return null
  const file = path.join(config.tableDir, ...source.file.split('/'))
  if (!fs.existsSync(file)) return null
  return parseTsv(file, source.id, source.name, source.extra, source.owner, source.owner ? 0 : undefined, Boolean(source.invert))
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

function sendJson(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
  res.end(body)
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
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

      if (url.pathname === '/api/panel/accounts') {
        const file = path.join(config.serverDir || '', 'admin-token.txt')
        if (!fs.existsSync(file)) return sendJson(res, { code: -1, msg: 'admin token not found - start the server once' }, 404)
        const token = fs.readFileSync(file, 'utf8').trim()
        fetch('http://127.0.0.1:' + config.sdkPort + '/api/admin/accounts', { headers: { 'X-Admin-Token': token } })
          .then((r) => r.json().then((body) => sendJson(res, body, r.status)))
          .catch((err) => sendJson(res, { code: -1, msg: err.message }, 502))
        return
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
    await stopAll()
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

async function rebuildServer() {
  // Snapshot first: a rebuild that goes wrong should cost time, not data.
  // The IPC layer awaits this; a failed snapshot must not stop the build.
  await backupNow('rebuild').catch((err) => log(`backup skipped: ${err.message}`))

  const project = path.join(config.repoRoot || path.join(__dirname, '..'), 'AscNet', 'AscNet.csproj')
  if (!fs.existsSync(project)) throw new Error(`project not found: ${project}`)

  const dotnet = process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe') : 'dotnet'
  return new Promise((resolve) => {
    const child = spawnHidden(dotnet, ['build', project, '-v', 'q', '--nologo'], { cwd: path.dirname(path.dirname(project)) })
    child.on('exit', (code) => resolve({ ok: code === 0 }))
  })
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await mainWindow.loadURL(`http://127.0.0.1:${uiPort}/ui/index.html`)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  fs.mkdirSync(logDir, { recursive: true })
  uiPort = await startUiServer()
  // Persist the port: it is ephemeral, and the smoke test (and any support request)
  // needs to know where the shell is actually listening.
  fs.writeFileSync(path.join(logDir, 'ui-port.txt'), String(uiPort))
  log(`ui served on http://127.0.0.1:${uiPort}`)

  // Handlers must exist before the window loads, or the page's first calls race the
  // registration and fail with "No handler registered".
  ipcMain.handle('stack:status', () => status())
  ipcMain.handle('stack:start', () => startAll())
  ipcMain.handle('stack:stop', () => stopAll())
  ipcMain.handle('stack:launch', () => { launchClient(); return true })
  ipcMain.handle('stack:logs', () => logLines)
  ipcMain.handle('stack:config', () => ({ uiPort, sdkPort: config.sdkPort, gameDir: config.gameDir }))
  ipcMain.handle('config:get', () => settingsSnapshot())
  ipcMain.handle('config:set', (_event, next) => persistSettings(next || {}))
  ipcMain.handle('config:browse', (_event, payload) => browsePath(payload.key, payload.current))
  ipcMain.handle('tools:install-mongo', () => installMongo())
  ipcMain.handle('tools:rebuild', () => rebuildServer())
  ipcMain.handle('update:check', (_event, repo) => checkUpdate(repo))
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
  await stopAll()
  app.quit()
})

app.on('before-quit', () => {
  for (const key of ['server', 'mongo']) {
    const child = running[key]
    if (child && !child.killed) child.kill()
  }
})