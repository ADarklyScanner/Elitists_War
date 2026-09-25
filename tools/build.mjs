// Builds dist/elitists-war.html: one self-contained page (engine + card data + UI).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Offline build (play the computer, saves in the browser) for the Artifact, and an online build
// (Supabase sign-in, games on the server) for the website.
const online = process.argv.includes('--online');
const cfg = online ? JSON.parse(readFileSync('supabase/config.json', 'utf8')) : { url: '', key: '' };
const out = await build({
  entryPoints: ['src/ui/main.ts'], bundle: true, format: 'iife', minify: !process.env.NOMINIFY, write: false, target: 'es2020',
  define: { __ONLINE__: String(online), __SB_URL__: JSON.stringify(cfg.url), __SB_KEY__: JSON.stringify(cfg.key) },
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
// Pictures the stylesheet points at (card backs) are embedded, so the page stays a single file.
const css = readFileSync('src/ui/style.css', 'utf8').replace(/url\("assets\/([\w.-]+)"\)/g, (_, f) =>
  `url("data:image/${f.split('.').pop()};base64,${readFileSync(`src/ui/assets/${f}`).toString('base64')}")`);
const html = `<title>Elitists War</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&family=Saira+Condensed:wght@500;600;700&display=swap">
<style>${css}</style>
${online ? '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>' : ''}
<div id="app"></div>
<script>${js}</script>
`;
if (online) {
  mkdirSync('site', { recursive: true });
  writeFileSync('site/index.html', `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n${html}</html>`);
  console.log(`site/index.html ${(html.length / 1024).toFixed(0)} KB`);
} else {
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/elitists-war.html', html);
  console.log(`dist/elitists-war.html ${(html.length / 1024).toFixed(0)} KB`);
}
