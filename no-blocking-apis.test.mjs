import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

test('cost report scans session directories asynchronously', () => {
  assert.doesNotMatch(source, /\b(existsSync|readdirSync)\b/);
});
