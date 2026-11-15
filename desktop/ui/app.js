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
  mail: 'Mail',
  config: 'Configuration',
  update: 'Updates',
}

function show(view) {
  // The shell used to come back on Console after any reload, which read as a tab jumping
  // by itself. The view is remembered, so a reload restores what the user was looking at.
  try { localStorage.setItem('selena.view', view) } catch (error) { /* private mode */ }
  tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.view === view))
  views.forEach((v) => v.classList.toggle('is-active', v.dataset.view === view))

  const subtitle = document.querySelector('#brandSubtitle')
  if (subtitle) subtitle.textContent = SUBTITLES[view] || 'Console'

  // Frames load lazily so a panel only runs once it is actually opened.
  if (view === 'gm' && !document.querySelector('#frameGm').src) document.querySelector('#frameGm').src = '/gm/index.html'
  if (view === 'player' && !document.querySelector('#framePlayer').src) document.querySelector('#framePlayer').src = '/player/index.html'
  if (view === 'accounts') loadAccounts()
  if (view === 'mail') loadMailRecipients()
  if (view === 'config') loadConfig()
  if (view === 'update') {
    // Keep what the user typed: only fill the field when it is still empty.
    const field = document.querySelector('#cfgRepo')
    if (!field.value) field.value = settings.repo || ''
    loadUpdateState()
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.view)))

let restored = 'console'
try { restored = localStorage.getItem('selena.view') || 'console' } catch (error) { restored = 'console' }
if (!document.querySelector(`.tab[data-view="${restored}"]`)) restored = 'console'
show(restored)

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
    note.textContent = `${payload.total} account${payload.total === 1 ? '' : 's'}`

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
      level.textContent = account.playerPresent ? account.level : 'none'

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
    note.textContent = 'accounts unavailable'
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

// ------------------------------------------------------------------- mail

// Mail is delivered through the admin endpoint, not the command layer: that layer needs a
// live session, and mailing an account that is not logged in is the normal case. An online
// player gets the mailbox push straight away; the row is durable either way.

let mailItems = null
const mailAttachments = []

// PlayerMail.Status as MailModule reads it: 0 unread, 1 read, 3 claimed, 4 deleted.
const MAIL_STATUS = ['unread', 'read', 'unread', 'claimed', 'deleted']

async function loadMailItems() {
  if (mailItems) return mailItems
  const response = await fetch('/api/panel/catalog/items')
  const payload = await response.json()
  mailItems = payload.entries || []
  return mailItems
}

function itemLabel(id) {
  const entry = (mailItems || []).find((candidate) => candidate.id === Number(id))
  return entry ? `${entry.name} · ${entry.id}` : `item ${id}`
}

function renderAttachments() {
  const body = document.querySelector('#mailAttachmentTable tbody')
  body.textContent = ''

  for (const entry of mailAttachments) {
    const row = document.createElement('tr')

    const name = document.createElement('td')
    name.textContent = itemLabel(entry.id)

    const count = document.createElement('td')
    const input = document.createElement('input')
    input.className = 'input input--count'
    input.inputMode = 'numeric'
    input.value = String(entry.count)
    input.addEventListener('change', () => {
      const next = Math.floor(Number(input.value))
      if (!Number.isFinite(next) || next <= 0) { input.value = String(entry.count); return }
      entry.count = next
      input.value = String(entry.count)
    })
    count.appendChild(input)

    const actions = document.createElement('td')
    actions.className = 'table__actions'
    const remove = document.createElement('button')
    remove.className = 'btn btn--quiet'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      mailAttachments.splice(mailAttachments.indexOf(entry), 1)
      renderAttachments()
    })
    actions.appendChild(remove)

    row.append(name, count, actions)
    body.appendChild(row)
  }

  document.querySelector('#mailAttachmentTable').style.display = mailAttachments.length === 0 ? 'none' : ''

  const note = document.querySelector('#mailItemNote')
  if (note) note.textContent = mailAttachments.length === 0
    ? 'no attachment - the mail is information only'
    : `${mailAttachments.length} attachment${mailAttachments.length === 1 ? '' : 's'}`
}

function renderItemHits(query) {
  const hits = document.querySelector('#mailItemHits')
  hits.textContent = ''
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return

  const matches = (mailItems || [])
    .filter((entry) => String(entry.id).startsWith(needle) || entry.name.toLowerCase().includes(needle))
    .slice(0, 8)

  if (matches.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'hits__empty'
    empty.textContent = 'no item matches that'
    hits.appendChild(empty)
    return
  }

  for (const entry of matches) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.className = 'hit'
    button.type = 'button'

    const name = document.createElement('b')
    name.textContent = entry.name
    const meta = document.createElement('span')
    meta.textContent = entry.meta ? ` · ${entry.id} · ${entry.meta}` : ` · ${entry.id}`

    button.append(name, meta)
    button.addEventListener('click', () => addAttachment(entry))
    item.appendChild(button)
    hits.appendChild(item)
  }
}

function addAttachment(entry) {
  const countField = document.querySelector('#mailItemCount')
  const count = Math.floor(Number(countField.value)) || 1
  const existing = mailAttachments.find((candidate) => candidate.id === entry.id)
  if (existing) existing.count += count
  else mailAttachments.push({ id: entry.id, count })

  document.querySelector('#mailItemSearch').value = ''
  document.querySelector('#mailItemHits').textContent = ''
  countField.value = '1'
  renderAttachments()
}

async function loadMailRecipients() {
  const picker = document.querySelector('#mailRecipient')
  const previous = picker.value

  try {
    const payload = await adminRequest('/api/admin/accounts')
    const options = [{ value: 'all', label: `All accounts (${payload.total})` }]
    for (const account of payload.accounts) {
      options.push({
        value: String(account.uid),
        label: `${account.uid} · ${account.username}${account.playerPresent ? ' · ' + (account.playerName || 'player') : ' · no player yet'}`,
      })
    }

    // Keep the account the user was looking at instead of jumping back to "all".
    const keep = options.some((option) => option.value === previous) ? previous : options[0].value
    picker.options = options
    picker.value = keep
  } catch (err) {
    appendTo('mailLog', 'could not list accounts: ' + err.message)
  }

  renderAttachments()
  // Warm the catalog the picker filters, so the first keystroke is instant.
  loadMailItems()
  loadRecentMail()
}

async function loadRecentMail() {
  const body = document.querySelector('#mailRecentTable tbody')
  const recipient = document.querySelector('#mailRecipient').value
  body.textContent = ''

  if (!recipient || recipient === 'all') {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 5
    cell.className = 'dim'
    cell.textContent = 'pick a single account to read its mailbox'
    row.appendChild(cell)
    body.appendChild(row)
    return
  }

  try {
    const payload = await adminRequest(`/api/admin/mail?uid=${encodeURIComponent(recipient)}`)
    if (payload.mails.length === 0) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 5
      cell.className = 'dim'
      cell.textContent = 'the mailbox is empty'
      row.appendChild(cell)
      body.appendChild(row)
      return
    }

    for (const mail of payload.mails.slice(0, 20)) {
      const row = document.createElement('tr')

      // Shipped mails carry client markup in the subject and the sender name.
      const subject = document.createElement('td')
      subject.textContent = mail.title.replace(/<[^>]*>/g, '')
      if (mail.content) subject.title = mail.content.replace(/<[^>]*>/g, '')

      const from = document.createElement('td')
      from.textContent = mail.sendName.replace(/<[^>]*>/g, '')

      const received = document.createElement('td')
      received.textContent = new Date(mail.createTime * 1000).toLocaleString()

      const items = document.createElement('td')
      items.textContent = mail.attachments ? String(mail.attachments.length) : 'none'
      if (!mail.attachments) items.className = 'dim'

      const status = document.createElement('td')
      status.textContent = MAIL_STATUS[mail.status] || String(mail.status)

      row.append(subject, from, received, items, status)
      body.appendChild(row)
    }
  } catch (err) {
    appendTo('mailLog', 'could not read the mailbox: ' + err.message)
  }
}

document.querySelector('#btnRefreshMail').addEventListener('click', loadMailRecipients)

document.querySelector('#mailRecipient').addEventListener('change', loadRecentMail)

document.querySelector('#mailItemSearch').addEventListener('input', async () => {
  // Read the field after the await, not event.currentTarget before it: that is null once the
  // handler awaits, and a captured value can be a keystroke behind the field by then.
  await loadMailItems()
  renderItemHits(document.querySelector('#mailItemSearch').value)
})

document.querySelector('#btnAddAttachment').addEventListener('click', async () => {
  await loadMailItems()
  const needle = document.querySelector('#mailItemSearch').value.trim()
  const entry = (mailItems || []).find((candidate) => String(candidate.id) === needle)
    || (mailItems || []).find((candidate) => candidate.name.toLowerCase() === needle.toLowerCase())
  if (!entry) { appendTo('mailLog', 'add the item from the search results, or type its exact id'); return }
  addAttachment(entry)
})

document.querySelector('#btnSendMail').addEventListener('click', async (event) => {
  const button = event.currentTarget
  const recipient = document.querySelector('#mailRecipient').value
  const subject = document.querySelector('#mailSubject').value.trim()
  const sender = document.querySelector('#mailSender').value.trim()

  if (!recipient) { appendTo('mailLog', 'pick a recipient first'); return }
  if (!subject) { appendTo('mailLog', 'a subject is required'); return }

  button.disabled = true
  document.querySelector('#mailNote').textContent = 'sending…'
  try {
    const report = await adminRequest('/api/admin/mail', {
      Recipient: recipient,
      Sender: sender,
      Subject: subject,
      Body: document.querySelector('#mailBody').value,
      Attachments: mailAttachments.map((entry) => ({ TemplateId: entry.id, Count: entry.count })),
    })

    const total = report.delivered + report.skipped
    const line = `sent to ${report.delivered} of ${total} account${total === 1 ? '' : 's'}`
    document.querySelector('#mailNote').textContent = line
    appendTo('mailLog', line)
    for (const result of report.results) {
      if (!result.ok) appendTo('mailLog', `  uid ${result.uid}: ${result.reason}`)
    }

    if (report.delivered > 0) {
      document.querySelector('#mailSubject').value = ''
      document.querySelector('#mailBody').value = ''
      mailAttachments.length = 0
      renderAttachments()
    }
    loadRecentMail()
  } catch (err) {
    document.querySelector('#mailNote').textContent = 'send failed'
    appendTo('mailLog', 'send failed: ' + err.message)
  } finally {
    button.disabled = false
  }
})

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

// "Update now" is offered only when the local HEAD differs from GitHub and the tree is clean:
// the pull is fast-forward only, so uncommitted work would stop it anyway.
function updateRow(id, text, state) {
  const node = document.querySelector('#' + id)
  if (!node) return
  node.textContent = text
  node.className = state === undefined ? 'dim' : (state ? '' : 'bad')
}

function paintUpdate(status) {
  const button = document.querySelector('#btnUpdateNow')

  if (!status.ok) {
    for (const id of ['updLocal', 'updBranch', 'updSha', 'updMsg', 'updDate']) updateRow(id, '—')
    updateRow('updTree', status.reason, false)
    updateRow('updState', status.reason, false)
    button.disabled = true
    return
  }

  updateRow('updLocal', status.local.sha, true)
  updateRow('updBranch', status.local.branch, true)
  updateRow('updTree', status.dirty ? `${status.dirtyFiles} changed file${status.dirtyFiles === 1 ? '' : 's'}` : 'clean', !status.dirty)

  if (status.remote) {
    updateRow('updSha', status.remote.sha, true)
    updateRow('updMsg', status.remote.message, true)
    updateRow('updDate', new Date(status.remote.date).toLocaleString(), true)
  } else {
    for (const id of ['updSha', 'updMsg', 'updDate']) updateRow(id, '—')
  }

  const state = !status.remote
    ? status.remoteError
    : status.upToDate
      ? 'up to date'
      : status.dirty
        ? 'differs from GitHub, but the tree has local changes'
        : 'update available'
  updateRow('updState', state, Boolean(status.remote && (status.upToDate || status.canUpdate)))

  button.disabled = !status.canUpdate
}

async function loadUpdateState() {
  const repo = document.querySelector('#cfgRepo').value.trim() || settings.repo || ''
  try {
    paintUpdate(await window.selena.updateStatus(repo))
  } catch (err) {
    appendTo('updateLog', 'could not read the repository state: ' + err.message)
  }
}

document.querySelector('#btnCheckUpdate').addEventListener('click', async (event) => {
  const button = event.currentTarget
  const repo = document.querySelector('#cfgRepo').value.trim()
  if (!repo) { appendTo('updateLog', 'enter owner/name first'); return }

  button.disabled = true
  appendTo('updateLog', `checking ${repo}…`)
  try {
    const status = await window.selena.updateStatus(repo)
    paintUpdate(status)
    // The tracked repository is a setting, so a checked repo survives a reload.
    if (repo !== settings.repo) settings = await window.selena.saveSettings({ repo })
    if (!status.ok) appendTo('updateLog', status.reason)
    else if (status.remoteError) appendTo('updateLog', 'GitHub: ' + status.remoteError)
    else appendTo('updateLog', status.upToDate ? 'local HEAD matches the newest commit' : 'the local HEAD differs from GitHub')
  } catch (err) {
    appendTo('updateLog', 'check failed: ' + err.message)
  } finally {
    button.disabled = false
  }
})

document.querySelector('#btnUpdateNow').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  appendTo('updateLog', 'applying the update…')

  try {
    const result = await window.selena.applyUpdate()
    for (const step of result.steps) {
      appendTo('updateLog', `  ${step.ok ? 'ok    ' : 'FAILED'}  ${step.name}${step.detail ? ': ' + step.detail : ''}`)
    }
    appendTo('updateLog', result.ok ? 'update applied' : 'update stopped at the step marked FAILED')
  } catch (err) {
    appendTo('updateLog', 'update failed: ' + err.message)
  } finally {
    button.disabled = false
    refresh()
    loadUpdateState()
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