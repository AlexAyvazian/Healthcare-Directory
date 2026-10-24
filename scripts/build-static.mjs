import {copyFile, mkdir, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root,'dist');
// Explicit allowlist: NEVER publish the Node server, environment files, scripts, or tests.
const files = [
  'index.html',
  'assets/css/healthcare.css',
  'assets/js/healthcare-map.js',
  'assets/js/neon-data.js',
  'assets/vendor/d3.min.js',
  'assets/vendor/topojson-client.min.js',
  'assets/vendor/us-atlas-counties-albers-10m.js',
  'assets/vendor/us-atlas.LICENSE'
];
await rm(dist, {force:true, recursive:true});
for (const file of files) {
  const destination = join(dist,file);
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(join(root,file),destination);
}
console.log('Static website ready in dist (' + files.length + ' public files).');
