/* Loads the vendored browser bundles (d3, topojson-client) into a sandbox so Node tools and tests
 * use exactly the same library code as the published site. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';

export function loadVendorGlobals(root) {
  const sandbox = {console};
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['assets/vendor/d3.min.js', 'assets/vendor/topojson-client.min.js']) {
    vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, {filename: file});
  }
  return {d3: sandbox.d3, topojson: sandbox.topojson};
}
