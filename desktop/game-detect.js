// Finding the player's game folder, without asking them for a path they never learned.
//
// Kept out of main.js so it can be exercised from the command line:
//   node -e "console.log(require('./game-detect').detectGameDir({ gameDir: '' }))"

const fs = require('fs')
const path = require('path')

// Steam keeps a list of library folders; games live under <library>/steamapps/common.
function steamLibraries() {
  const roots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    path.join(process.env.LOCALAPPDATA || '', 'Steam'),
  ]
  const libraries = []
  for (const root of roots) {
    if (!root) continue
    try {
      const text = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) libraries.push(match[1].replace(/\\\\/g, '\\'))
    } catch { /* no Steam here */ }
    if (fs.existsSync(path.join(root, 'steamapps', 'common'))) libraries.push(root)
  }
  return libraries
}

function gameCandidates(configured) {
  const candidates = []
  if (configured) candidates.push(configured)
  for (const library of steamLibraries()) {
    candidates.push(path.join(library, 'steamapps', 'common', 'Punishing Gray Raven', 'Punishing Gray Raven Game'))
    candidates.push(path.join(library, 'steamapps', 'common', 'Punishing Gray Raven'))
  }
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:', 'H:']) {
    candidates.push(path.join(drive + '\\', 'Punishing Gray Raven', 'Punishing Gray Raven Game'))
    candidates.push(path.join(drive + '\\', 'Games', 'Punishing Gray Raven', 'Punishing Gray Raven Game'))
    candidates.push(path.join(drive + '\\', 'gemink', 'Punishing Gray Raven', 'Punishing Gray Raven Game'))
    candidates.push(path.join(drive + '\\', 'Punishing Gray Raven Game'))
  }
  return candidates
}

// A folder counts when PGR.exe sits in it or in its nested "Punishing Gray Raven Game".
function resolveInstalled(candidate) {
  if (!candidate) return ''
  if (fs.existsSync(path.join(candidate, 'PGR.exe'))) return candidate
  const nested = path.join(candidate, 'Punishing Gray Raven Game')
  if (fs.existsSync(path.join(nested, 'PGR.exe'))) return nested
  return ''
}

// A copy that already carries the patch wins: the pristine client must stay untouched. With several
// unpatched copies the app asks instead of guessing which one the player meant.
function detectGameDir(config, log) {
  const found = []
  for (const candidate of gameCandidates(config && config.gameDir)) {
    const dir = resolveInstalled(candidate)
    if (dir && !found.includes(dir)) found.push(dir)
  }

  const patched = found.filter((dir) => fs.existsSync(path.join(dir, 'ascnet-patch.log')))
  if (patched.length > 0) return patched[0]
  if (found.length === 1) return found[0]
  if (found.length > 1 && typeof log === 'function') {
    log(`several game folders found, pick one in Config: ${found.join(' | ')}`)
  }
  return ''
}

module.exports = { detectGameDir, gameCandidates, steamLibraries, resolveInstalled }