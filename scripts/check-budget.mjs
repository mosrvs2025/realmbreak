#!/usr/bin/env node
/**
 * Performance budget gate (run after `npm run build`). Fails CI when a limit is exceeded.
 *
 * The landing page must stay tiny (the 3D game is a lazily loaded chunk), and the whole game
 * must stay lean enough to start quickly on a headset's mobile-class connection.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const dist = resolve('dist');
const KB = 1024;
const budgets = {
  'entry JS (landing page), gzip': { limit: 12 * KB, pick: (f) => /^assets\/index-.*\.js$/.test(f), gz: true },
  'game chunk JS (three.js + game), gzip': { limit: 200 * KB, pick: (f) => /^assets\/game-.*\.js$/.test(f), gz: true },
  'all JS, gzip': { limit: 215 * KB, pick: (f) => f.endsWith('.js'), gz: true },
  'CSS, gzip': { limit: 6 * KB, pick: (f) => f.endsWith('.css'), gz: true },
  'index.html, gzip': { limit: 8 * KB, pick: (f) => f === 'index.html', gz: true },
  'og-image.png (not on the critical path)': { limit: 900 * KB, pick: (f) => f === 'og-image.png', gz: false },
};

function walk(dir, base = dist) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [p.slice(base.length + 1)];
  });
}

const files = walk(dist);
let failed = false;
console.log('Performance budget\n');
for (const [name, b] of Object.entries(budgets)) {
  const size = files
    .filter(b.pick)
    .reduce((s, f) => s + (b.gz ? gzipSync(readFileSync(join(dist, f))).length : statSync(join(dist, f)).size), 0);
  const ok = size <= b.limit;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(46)} ${(size / KB).toFixed(1).padStart(7)} KB / ${(b.limit / KB).toFixed(0)} KB`);
}
if (failed) {
  console.error('\nBudget exceeded.');
  process.exit(1);
}
