import { build } from 'esbuild'

/*
 * Bundles the shared control elements into one classic script the panel server can hand out next to
 * ui.js. The source lives under web-ui, the dependencies live here, so the resolution path is
 * stated instead of moving the sources.
 */
await build({
  entryPoints: ['../web-ui/common/components/index.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome120'],
  nodePaths: ['./node_modules'],
  outfile: '../web-ui/common/components.js',
  logLevel: 'info',
})