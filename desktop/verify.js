// Setup checks, kept free of electron so they can be run from the command line:
//   node -e "console.log(require('./verify').buildChecks())"
// A failing check must say what is missing *and* which control fixes it, because the
// audience is a player, not someone who reads stack traces.

const fs = require('fs')
const path = require('path')

function exists(target) {
  try {
    return Boolean(target) && fs.existsSync(target)
  } catch {
    return false
  }
}

function buildChecks(config, tools = {}) {
  const checks = []
  const add = (id, ok, detail, fix, label) => checks.push({ id, label, ok, detail, fix })

  // A packaged build carries the server in resources/runtime, so there is nothing to clone or build: the
  // repository check only means something in a development checkout.
  if (config.repoRoot) {
    const repoProject = path.join(config.repoRoot, 'AscNet', 'AscNet.csproj')
    add('repo', exists(repoProject), exists(repoProject) ? config.repoRoot : 'source not cloned yet', 'clone-repo', 'Repository')
  }

  // The source is built here, so the two programs that build it are setup as well.
  add('git', Boolean(tools.git), tools.git || 'git not installed', 'install-git', 'Git')
  add('dotnet', Boolean(tools.dotnet), tools.dotnet || '.NET SDK not installed', 'install-dotnet', '.NET SDK')

  const serverDll = path.join(config.serverDir || '', 'AscNet.dll')
  add('server', exists(serverDll), exists(serverDll) ? config.serverDir : 'server not built yet', 'build-server', 'Server build')

  add('mongod', exists(config.mongoBinary), exists(config.mongoBinary) ? config.mongoBinary : 'mongod.exe not installed', 'install-mongo', 'MongoDB')

  const itemTable = path.join(config.tableDir || '', 'share', 'item', 'Item.tsv')
  add('table', exists(itemTable), exists(itemTable) ? config.tableDir : 'table data missing', 'clone-repo', 'Game tables')

  const gameExe = config.gameDir ? path.join(config.gameDir, 'PGR.exe') : ''
  add('game', exists(gameExe), exists(gameExe) ? config.gameDir : 'game folder not selected', 'browse-game', 'Game directory')

  const patchState = config.gameDir ? path.join(config.gameDir, '.ascnet-launcher', 'state.json') : ''
  add('patch', exists(patchState), exists(patchState) ? 'client patched' : 'client not patched yet', 'clone-repo', 'Client patch')

  return { ok: checks.every((check) => check.ok), checks }
}

module.exports = { buildChecks }