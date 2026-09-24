// Bundles the engine + online service into supabase/functions/ew-game/game.js for the Edge Function.
// Card descriptions are only needed by the website, so the server gets a slim copy of cards.json.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const keep = ['id', 'name', 'type', 'subtype', 'power', 'globalPower', 'resistance', 'alignments', 'conditionalAlignments', 'attributes', 'arrowIn', 'arrowsOut', 'uniqueness', 'attackPower'];
// Some card scripts read the wording of Resources and Disasters (e.g. "Gadget", "Space Disaster").
const slim = JSON.parse(readFileSync('src/data/cards.json', 'utf8')).map((c) => {
  const out = Object.fromEntries(keep.filter((k) => c[k] !== undefined && c[k] !== null).map((k) => [k, c[k]]));
  out.text = c.type === 'Resource' || c.subtype === 'Disaster' ? c.text : '';
  if (c.type === 'Resource') out.notes = c.notes;
  return out;
});
const slimPlugin = {
  name: 'slim-cards',
  setup(b) {
    b.onLoad({ filter: /data[\\/]cards\.json$/ }, () => ({ contents: JSON.stringify(slim), loader: 'json' }));
  },
};
await build({
  stdin: { contents: "export { handle } from './src/server/api.ts'; export { SupabaseStore } from './src/server/supabaseStore.ts';", resolveDir: '.', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true, legalComments: 'none',
  plugins: [slimPlugin],
  outfile: 'supabase/functions/ew-game/game.js',
});
console.log('built supabase/functions/ew-game/game.js');
