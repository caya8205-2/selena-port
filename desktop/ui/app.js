// Shell page: tab switching, live status, config form and update check.
// The panels live in frames; everything else is a thin surface over the preload API.

const tabs = document.querySelectorAll('.tab')
const views = document.querySelectorAll('.view')

// The subtitle names the tool the user is looking at, not the shell.
const SUBTITLES = {
  console: 'Console',
  gm: 'GM console',
  player: 'Player console',
  accounts: 'Accounts',
  config: 'Configuration',
  update: 'Updates',
}

function show(view) {
  tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.view === view))
  views.forEach((v) => v.classList.toggle('is-active', v.dataset.view === view))

  const subtitle = document.querySelector('#brandSubtitle')
  if (subtitle) subtitle.textContent = SUBTITLES[view] || 'Console'

  // Frames load lazily so a panel only runs once it is actually opened.
  if (view === 'gm' && !document.querySelector('#frameGm').src) document.querySelector('#frameGm').src = '/gm/index.html'
  if (view === 'player' && !document.querySelector('#framePlayer').src) document.querySelector('#framePlayer').src = '/player/index.html'
  if (view === 'accounts') loadAccounts()
  if (view === 'config') loadConfig()
  if (view === 'update') document.querySelector('#cfgRepo').value = settings.repo || ''
}

tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.view)))

// ------------------------------------------------------------------- logging

const logBox = document.querySelector('#log')
function append(line) {
  logBox.textContent += line + '\n'
  logBox.scrollTop = logBox.scrollHeight
}

function appendTo(id, line) {
  const box = document.querySelector('#' + id)
  if (!box) return
  box.textContent += line + '\n'
  box.scrollTop = box.scrollHeight
}

window.selena.onLog(append)

// ------------------------------------------------------------------- status

function paintStatus(state) {
  const mongo = document.querySelector('#rowMongo')
  const sdk = document.querySelector('#rowSdk')

  mongo.textContent = state.mongo ? 'listening' : 'stopped'
  mongo.className = state.mongo ? '' : 'dim'
  sdk.textContent = state.sdk
    ? `SDK ${state.sdkPort} · game ${state.gamePort}`
    : `stopped (SDK ${state.sdkPort})`
  sdk.className = state.sdk ? '' : 'dim'

  document.querySelector('#rowGameDir').textContent = state.gameDir || 'not configured'
  document.querySelector('#rowGameDir').className = state.gameDir ? '' : 'dim'
  document.querySelector('#dotMongo').classList.toggle('is-up', state.mongo)
  document.querySelector('#dotSdk').classList.toggle('is-up', state.sdk)
  document.querySelector('#dotGame').classList.toggle('is-up', state.game)
}

async function refresh() {
  paintStatus(await window.selena.status())
}

document.querySelector('#btnStart').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  try { paintStatus(await window.selena.start()) } catch (err) { append('start failed: ' + err.message) } finally { button.disabled = false }
})

document.querySelector('#btnStop').addEventListener('click', async () => {
  try { paintStatus(await window.selena.stop()) } catch (err) { append('stop failed: ' + err.message) }
})

document.querySelector('#btnOpenLogs').addEventListener('click', () => window.selena.openLogs())

document.querySelector('#btnLaunch').addEventListener('click', async () => {
  try { await window.selena.launch() } catch (err) { append('launch failed: ' + err.message) }
})


// ------------------------------------------------------------------- accounts

// Administration goes through the server's admin endpoints: they work whenever the
// server is up, which is what "no sign-in needed" means. The token is read by the main
// process from beside the server build and never travels in a URL.
async function adminRequest(path, body) {
  const token = await window.selena.adminToken()
  if (!token) throw new Error('admin token not found - start the server once so it can create it')

  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Admin-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error((data && data.msg) || `HTTP ${response.status}`)
  return data
}

async function loadAccounts() {
  const body = document.querySelector('#accountsTable tbody')
  const note = document.querySelector('#accountsNote')
  body.textContent = ''
  note.textContent = 'loading…'

  try {
    const payload = await adminRequest('/api/admin/accounts')
    note.textContent = `${payload.total} account${payload.total === 1 ? '' : 's'} · no sign-in needed`

    for (const account of payload.accounts) {
      const row = document.createElement('tr')

      const name = document.createElement('td')
      name.textContent = account.username

      const uid = document.createElement('td')
      uid.textContent = account.uid

      const player = document.createElement('td')
      player.textContent = account.playerPresent ? (account.playerName || 'yes') : 'none'
      if (!account.playerPresent) player.className = 'dim'

      const level = document.createElement('td')
      level.textContent = account.playerPresent ? account.level : '—'

      const actions = document.createElement('td')
      actions.className = 'table__actions'

      const edit = document.createElement('button')
      edit.className = 'btn btn--quiet'
      edit.textContent = 'Edit'
      edit.disabled = !account.playerPresent
      edit.title = account.playerPresent ? '' : 'this account has not logged in yet'
      edit.addEventListener('click', () => editAccount(account))

      const reset = document.createElement('button')
      reset.className = 'btn btn--quiet'
      reset.textContent = 'Reset'
      reset.addEventListener('click', () => confirmAccountAction('reset', account))

      const remove = document.createElement('button')
      remove.className = 'btn btn--quiet'
      remove.textContent = 'Delete'
      remove.addEventListener('click', () => confirmAccountAction('delete', account))

      actions.append(edit, reset, remove)
      row.append(name, uid, player, level, actions)
      body.appendChild(row)
    }
  } catch (err) {
    note.textContent = ''
    appendTo('accountsLog', 'could not list accounts: ' + err.message)
  }
}

async function editAccount(account) {
  const name = window.prompt('Commandant name', account.playerName || '')
  if (name === null) return
  const level = window.prompt('Level', String(account.level || 1))
  if (level === null) return

  try {
    await adminRequest(`/api/admin/accounts/${account.uid}/player`, {
      Name: name.trim() || null,
      Level: Number(level) > 0 ? Number(level) : null,
    })
    appendTo('accountsLog', `updated ${account.username}`)
    loadAccounts()
  } catch (err) {
    appendTo('accountsLog', 'update failed: ' + err.message)
  }
}

async function confirmAccountAction(kind, account) {
  const typed = window.prompt(`Type ${account.username} to ${kind} UID ${account.uid}`)
  if (typed === null) return
  if (typed.trim() !== account.username) {
    appendTo('accountsLog', `${kind} cancelled: the username did not match`)
    return
  }

  try {
    await adminRequest(`/api/admin/accounts/${account.uid}/${kind}`)
    appendTo('accountsLog', `${kind} ${account.username} done`)
    loadAccounts()
  } catch (err) {
    appendTo('accountsLog', `${kind} failed: ` + err.message)
  }
}

document.querySelector('#btnCreateAccount').addEventListener('click', async () => {
  const username = document.querySelector('#newUsername').value.trim()
  const password = document.querySelector('#newPassword').value
  if (!username || !password) { appendTo('accountsLog', 'username and password are required'); return }

  try {
    await adminRequest('/api/admin/accounts', { Username: username, Password: password })
    appendTo('accountsLog', `created ${username}`)
    document.querySelector('#newUsername').value = ''
    document.querySelector('#newPassword').value = ''
    loadAccounts()
  } catch (err) {
    appendTo('accountsLog', 'create failed: ' + err.message)
  }
})

document.querySelector('#btnRefreshAccounts').addEventListener('click', loadAccounts)

// ------------------------------------------------------------------- config

let settings = {}

const CONFIG_FIELDS = {
  gameDir: '#cfgGameDir',
  serverDir: '#cfgServerDir',
  mongoBinary: '#cfgMongoBinary',
}

// The setup block answers "what is missing" before the user hits a failure later.
// Each row names the control that fixes it, so the button is next to the complaint.
function renderSetup(result) {
  const host = document.querySelector('#setupRows')
  if (!host) return
  host.textContent = ''

  const labelFor = {
    'clone-repo': 'Clone repository below',
    'build-server': 'Build server below',
    'install-mongo': 'Install MongoDB below',
    'browse-game': 'Browse game directory below',
  }

  for (const check of result.checks) {
    const row = document.createElement('div')
    row.className = 'row'

    const name = document.createElement('span')
    name.textContent = check.label

    const value = document.createElement('b')
    value.textContent = check.ok ? 'ready' : (labelFor[check.fix] || check.detail)
    if (!check.ok) value.className = 'bad'

    row.appendChild(name)
    row.appendChild(value)
    host.appendChild(row)
  }
}

async function refreshSetup() {
  try {
    renderSetup(await window.selena.verifySetup())
  } catch (err) {
    append('setup check failed: ' + err.message)
  }
}

async function loadConfig() {
  settings = await window.selena.settings()
  for (const [key, selector] of Object.entries(CONFIG_FIELDS)) {
    document.querySelector(selector).value = settings[key] || ''
  }
  document.querySelector('#cfgRepo').value = settings.repo || ''
  document.querySelector('#cfgRepoUrl').value = settings.repoUrl || ''

  // The button reports what it will do now, so the same control is "Build" the first
  // time and "Rebuild" afterwards instead of asking the user to know which applies.
  document.querySelector('#btnRebuild').textContent = settings.serverExists ? 'Rebuild server' : 'Build server'
  document.querySelector('#btnInstallMongo').textContent = settings.mongoExists ? 'Reinstall MongoDB' : 'Install MongoDB'
  document.querySelector('#btnCloneRepo').textContent = settings.repoCloned ? 'Repository cloned' : 'Clone repository'
  document.querySelector('#btnCloneRepo').disabled = Boolean(settings.repoCloned)

  document.querySelector('#mongoNote').textContent = settings.mongoExists
    ? `mongod at ${settings.mongoBinary}`
    : `will be installed into ${settings.mongoDir}`

  if (!settings.mongoExists) appendTo('configLog', 'mongod.exe not found at the configured path')
  refreshSetup()
}

document.querySelectorAll('[data-browse]').forEach((button) => {
  button.addEventListener('click', async () => {
    const key = button.dataset.browse
    const field = document.querySelector(CONFIG_FIELDS[key])
    const picked = await window.selena.browse({ key, current: field.value })
    if (picked) field.value = picked
  })
})

document.querySelector('#btnCloneRepo').addEventListener('click', async (event) => {
  const button = event.currentTarget
  const url = document.querySelector('#cfgRepoUrl').value.trim()
  button.disabled = true
  appendTo('configLog', 'cloning repository…')
  try {
    const result = await window.selena.cloneRepo(url)
    appendTo('configLog', result.already ? 'already cloned at ' + result.target : 'cloned into ' + result.target)
    loadConfig()
  } catch (err) {
    appendTo('configLog', 'clone failed: ' + err.message)
    button.disabled = false
  }
})

document.querySelector('#btnSaveConfig').addEventListener('click', async () => {
  const next = {}
  for (const [key, selector] of Object.entries(CONFIG_FIELDS)) next[key] = document.querySelector(selector).value.trim()
  next.repo = document.querySelector('#cfgRepo').value.trim()

  settings = await window.selena.saveSettings(next)
  appendTo('configLog', 'saved: ' + JSON.stringify(next))
  append('settings saved')
  refresh()
})

document.querySelector('#btnInstallMongo').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  appendTo('configLog', 'installing MongoDB (portable)…')
  try {
    const result = await window.selena.installMongo()
    document.querySelector('#cfgMongoBinary').value = result.mongoBinary
    appendTo('configLog', 'installed: ' + result.mongoBinary)
    refreshSetup()
  } catch (err) {
    appendTo('configLog', 'install failed: ' + err.message)
  } finally {
    button.disabled = false
  }
})

document.querySelector('#btnBackup').addEventListener('click', async () => {
  try {
    const result = await window.selena.backupNow()
    appendTo('configLog', 'backup: ' + result.path)
  } catch (err) {
    appendTo('configLog', 'backup failed: ' + err.message)
  }
})

document.querySelector('#btnOpenBackups').addEventListener('click', () => window.selena.openBackups())

document.querySelector('#btnRebuild').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  appendTo('configLog', 'rebuilding server…')
  try {
    const result = await window.selena.rebuildServer()
    appendTo('configLog', result.ok ? 'build finished' : 'build failed')
    refreshSetup()
  } catch (err) {
    appendTo('configLog', 'build failed: ' + err.message)
  } finally {
    button.disabled = false
  }
})

// ------------------------------------------------------------------- update

document.querySelector('#btnCheckUpdate').addEventListener('click', async (event) => {
  const button = event.currentTarget
  const repo = document.querySelector('#cfgRepo').value.trim()
  if (!repo) { appendTo('updateLog', 'enter owner/name first'); return }

  button.disabled = true
  appendTo('updateLog', `checking ${repo}…`)
  try {
    const commit = await window.selena.checkUpdate(repo)
    document.querySelector('#updSha').textContent = commit.sha
    document.querySelector('#updSha').className = ''
    document.querySelector('#updMsg').textContent = commit.message
    document.querySelector('#updMsg').className = ''
    document.querySelector('#updDate').textContent = new Date(commit.date).toLocaleString()
    document.querySelector('#updDate').className = ''
  } catch (err) {
    appendTo('updateLog', 'check failed: ' + err.message)
  } finally {
    button.disabled = false
  }
})

document.querySelector('#btnOpenRepo').addEventListener('click', async () => {
  const repo = document.querySelector('#cfgRepo').value.trim() || settings.repo
  if (repo) await window.selena.open(`https://github.com/${repo}`)
})

// ------------------------------------------------------------------- startup

window.selena.logs().then((lines) => lines.forEach(append))
window.selena.settings().then((value) => { settings = value })
refresh()
setInterval(refresh, 3000)