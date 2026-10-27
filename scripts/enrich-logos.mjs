/* Administrator CLI. Run in a private environment with the same env names as Cloudflare. */
import {readFile} from 'node:fs/promises';
import {enrichDirectory} from '../worker/src/logo-jobs.js';
import {enrichFacility} from '../worker/src/logos.js';
const args=process.argv.slice(2);
const directory=args[args.indexOf('--directory')+1];
if(!['usa','international'].includes(directory)) throw Error('Use --directory usa|international.');
if(args.includes('--file')) {
  const rows=JSON.parse(await readFile(args[args.indexOf('--file')+1],'utf8'));
  if(!Array.isArray(rows)) throw Error('Expected a JSON array of facility records.');
  for(const row of rows) console.log(String(row.id),await enrichFacility(process.env,directory,row));
} else {
  const batches=args.includes('--batches')?Number(args[args.indexOf('--batches')+1]):1;
  if(!Number.isSafeInteger(batches)||batches<1||batches>10000) throw Error('Use --batches 1..10000.');
  for(let i=0;i<batches;i++) console.log(await enrichDirectory(process.env,directory));
}
