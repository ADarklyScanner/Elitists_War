// Bundles the engine + online service into supabase/functions/ew-game/game.js for the Edge Function.
import { build } from 'esbuild';
await build({
  stdin: { contents: "export { handle } from './src/server/api.ts'; export { SupabaseStore } from './src/server/supabaseStore.ts';", resolveDir: '.', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
  outfile: 'supabase/functions/ew-game/game.js',
});
console.log('built supabase/functions/ew-game/game.js');
