// Backup helpers, electron-free so they can be exercised from the command line:
//   node -e "console.log(require('./backup').listBackups('C:/tmp/backups'))"
//
// A rebuild or an update can leave the database unusable; the rule here is that the
// snapshot happens before anything writes, and the newest five are kept so a rollback
// is a folder, not an archaeology project.

const fs = require('fs')
const path = require('path')

function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Copy the live data into a timestamped folder.
 * Returns the created path; throws only when there is something to copy but it cannot be read.
 */
function createBackup({ dataDir, configsDir, backupRoot, reason = 'manual', keep = 5 }) {
  if (!backupRoot) throw new Error('backup folder is not configured')
  fs.mkdirSync(backupRoot, { recursive: true })

  const sources = [dataDir, configsDir].filter((source) => source && fs.existsSync(source))
  if (sources.length === 0) throw new Error('nothing to back up yet')

  const target = path.join(backupRoot, `${stamp()}-${reason}`)
  fs.mkdirSync(target, { recursive: true })

  for (const source of sources) {
    const destination = path.join(target, path.basename(source))
    try {
      fs.cpSync(source, destination, { recursive: true, force: true })
    } catch (err) {
      // A running mongod holds WiredTiger's files open; copying then fails with EDOM.
      // Say what to do instead of surfacing the raw errno.
      if (err.code === 'EDOM' || err.code === 'EBUSY' || err.code === 'EPERM') {
        throw new Error('the database is still running and its files are locked - stop it before backing up')
      }
      throw err
    }
  }

  prune(backupRoot, keep)
  return target
}

function listBackups(backupRoot) {
  if (!backupRoot || !fs.existsSync(backupRoot)) return []
  return fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
}

function prune(backupRoot, keep) {
  const folders = listBackups(backupRoot)
  for (const name of folders.slice(keep)) {
    fs.rmSync(path.join(backupRoot, name), { recursive: true, force: true })
  }
}

module.exports = { createBackup, listBackups }