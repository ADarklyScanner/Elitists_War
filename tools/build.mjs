// Builds dist/elitists-war.html: one self-contained page (engine + card data + UI).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/ui/main.ts'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const css = readFileSync('src/ui/style.css', 'utf8');
const html = `<title>Elitists War</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&family=Saira+Condensed:wght@500;600;700&display=swap">
<style>${css}</style>
<div id="app"></div>
<script>${js}</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/elitists-war.html', html);
console.log(`dist/elitists-war.html ${(html.length / 1024).toFixed(0)} KB`);
