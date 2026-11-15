// Shell page: view switching plus the small status/action surface exposed by preload.

const buttons = document.querySelectorAll('.rail__item')
const views = document.querySelectorAll('.view')

function show(view) {
  buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view))
  views.forEach((v) => v.classList.toggle('is-active', v.dataset.view === view))

  // Frames load lazily so the panels only run when they are actually opened.
  if (view === 'gm' && !document.querySelector('#frameGm').src) document.querySelector('#frameGm').src = '/gm/index.html'
  if (view === 'player' && !document.querySelector('#framePlayer').src) document.querySelector('#framePlayer').src = '/player/index.html'
}

buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.view)))

const logBox = document.querySelector('#log')
function append(line) {
  logBox.textContent += line + '\n'
  logBox.scrollTop = logBox.scrollHeight
}

window.selena.onLog(append)

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
  paintStatus(await window.selena.stop())
})

document.querySelector('#btnLaunch').addEventListener('click', async () => {
  try { await window.selena.launch() } catch (err) { append('launch failed: ' + err.message) }
})

document.querySelector('#btnGm').addEventListener('click', () => show('gm'))
document.querySelector('#btnPlayer').addEventListener('click', () => show('player'))

window.selena.logs().then((lines) => { lines.forEach(append) })
refresh()
setInterval(refresh, 3000)
