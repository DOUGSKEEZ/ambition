// Run the deterministic parser against a saved HTML fixture (no DB/network).
//   npm run parse-test fixtures/some-profile.html
// Accepts either a raw .html file or a captured-payload .json file.
import { readFileSync } from 'node:fs';
import { parseProfile } from './parse.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run parse-test <fixture.html | payload.json>');
  process.exit(1);
}

const content = readFileSync(file, 'utf8');
let payload;

if (file.endsWith('.json')) {
  payload = JSON.parse(content);
} else {
  // Raw HTML: extract any embedded JSON-LD blocks too, so we exercise both paths.
  const jsonld = [...content.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((m) => m[1].trim());
  // Best-effort URL from a canonical link.
  const canon = content.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  payload = { url: canon?.[1] || '', html: content, jsonld };
}

const parsed = parseProfile(payload);
console.log(JSON.stringify(parsed, null, 2));
