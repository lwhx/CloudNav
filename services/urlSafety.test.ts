import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSafeSearchUrl, normalizeWebUrl } from './urlSafety';

test('normalizes bare domains to https', () => {
  assert.equal(normalizeWebUrl('example.com/path'), 'https://example.com/path');
});

test('rejects dangerous URL schemes', () => {
  assert.equal(normalizeWebUrl('javascript:alert(1)'), null);
  assert.equal(normalizeWebUrl('data:text/html,test'), null);
  assert.equal(normalizeWebUrl('file:///tmp/test'), null);
});

test('builds safe search URLs', () => {
  assert.equal(buildSafeSearchUrl('https://example.com?q={query}', 'a b'), 'https://example.com/?q=a%20b');
  assert.equal(buildSafeSearchUrl('javascript:{query}', 'alert(1)'), null);
});
