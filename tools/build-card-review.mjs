// Builds the card review page from drafted info sheets (one JSON file per card).
// Usage: node tools/build-card-review.mjs <sheets dir> <out.html> [second-draft dir]
// A second-draft folder holds another writer's version of each card (<id>.json) to show alongside.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const [dir, out, second] = process.argv.slice(2);
const sheets = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
if (second) for (const s of sheets) if (existsSync(`${second}/${s.id}.json`)) s.second = JSON.parse(readFileSync(`${second}/${s.id}.json`, 'utf8'));
const data = JSON.stringify(sheets).replace(/</g, '\\u003c');
writeFileSync(out, readFileSync(new URL('./card-review.template.html', import.meta.url), 'utf8').replace('/*SHEETS*/[]', data).replace('{{COUNT}}', String(sheets.length)));
console.log(`${out}: ${sheets.length} cards`);
