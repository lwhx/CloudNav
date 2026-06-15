// Standalone test for mergeAppData — no test framework required.
// Run: node --experimental-transform-types --test services/mergeAppData.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppData } from './mergeAppData.ts';

// Use real "now" so trash-expiry math (Date.now() - deletedAt > 30d) behaves
// like in production: a fresh deletedAt is NOT expired.
const now = Date.now();
const baseLocalLink = { id: 'L1', title: 'Local', url: 'https://local', categoryId: 'common', createdAt: now, tags: [] };
const baseCloudLink = { id: 'L2', title: 'Cloud', url: 'https://cloud', categoryId: 'dev', createdAt: now, tags: [] };
const defaultGroups = [{ id: 'default', name: '默认分组', icon: 'Folder', order: 0 }];
const defaultCats = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
];

test('union — local-only link survives when cloud is older', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink, title: 'LocalEdited' }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 1000,
    },
    cloud: {
      links: [{ ...baseCloudLink }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
  });
  assert.deepEqual(merged.links.map((l) => l.id).sort(), ['L1', 'L2']);
  const l1 = merged.links.find((l) => l.id === 'L1');
  assert.equal(l1?.title, 'LocalEdited');
});

test('core bug — local-only link survives even when cloud envelope updatedAt is NEWER', () => {
  // This is the original regression: cloud claims newer timestamp (KV lag / clock skew),
  // but cloud snapshot is missing the just-added local link.
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink, title: 'JustAdded' }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: {
      links: [{ ...baseCloudLink }], // missing L1
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 5000,
    },
  });
  assert.deepEqual(merged.links.map((l) => l.id).sort(), ['L1', 'L2']);
});

test('same id on both sides — per-record mtime wins over envelope timestamp', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink, title: 'LocalNewer', updatedAt: now + 100 }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 100,
    },
    cloud: {
      links: [{ ...baseLocalLink, title: 'CloudOlder', updatedAt: now }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 9999,
    },
  });
  const l1 = merged.links.find((l) => l.id === 'L1');
  assert.equal(l1?.title, 'LocalNewer');
});

test('soft-delete propagates from cloud when its record is newer', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseCloudLink, updatedAt: now }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: {
      links: [{ ...baseCloudLink, deletedAt: now + 50, deletedFromCategoryId: 'dev', updatedAt: now + 50 }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 50,
    },
  });
  const l2 = merged.links.find((l) => l.id === 'L2');
  assert.equal(typeof l2?.deletedAt, 'number');
});

test('newer local edit undeletes (tombstone does not win)', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseCloudLink, title: 'Restored', updatedAt: now + 200 }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 200,
    },
    cloud: {
      links: [{ ...baseCloudLink, deletedAt: now + 50, updatedAt: now + 50 }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 50,
    },
  });
  const l2 = merged.links.find((l) => l.id === 'L2');
  assert.equal(l2?.title, 'Restored');
  assert.equal(l2?.deletedAt, undefined);
});

test('empty cloud + has local — keep local', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: { links: [], categories: [], categoryGroups: [], updatedAt: 0 },
  });
  assert.deepEqual(merged.links.map((l) => l.id), ['L1']);
});

test('category merge union', () => {
  const merged = mergeAppData({
    local: {
      links: [],
      categories: [{ ...defaultCats[0] }, { id: 'cat-local', name: 'LocalCat', icon: 'Star' }],
      categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: {
      links: [],
      categories: [{ ...defaultCats[0] }, { id: 'cat-cloud', name: 'CloudCat', icon: 'Code' }],
      categoryGroups: defaultGroups, updatedAt: now,
    },
  });
  const ids = merged.categories.map((c) => c.id);
  assert.ok(ids.includes('cat-local'));
  assert.ok(ids.includes('cat-cloud'));
});

test('expired trash dropped', () => {
  const expired = now - 31 * 24 * 60 * 60 * 1000;
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink, deletedAt: expired }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: { links: [], categories: [], categoryGroups: [], updatedAt: 0 },
  });
  assert.deepEqual(merged.links, []);
});

test('full union when both sides have disjoint sets', () => {
  const merged = mergeAppData({
    local: {
      links: [
        { id: 'a', title: 'A', url: 'https://a', categoryId: 'common', createdAt: now },
        { id: 'b', title: 'B', url: 'https://b', categoryId: 'common', createdAt: now },
      ],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now,
    },
    cloud: {
      links: [{ id: 'c', title: 'C', url: 'https://c', categoryId: 'common', createdAt: now }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 99999,
    },
  });
  assert.deepEqual(merged.links.map((l) => l.id).sort(), ['a', 'b', 'c']);
});

test('merged envelope updatedAt = max of both sides', () => {
  const merged = mergeAppData({
    local: {
      links: [{ ...baseLocalLink }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 100,
    },
    cloud: {
      links: [{ ...baseCloudLink }],
      categories: defaultCats, categoryGroups: defaultGroups, updatedAt: now + 50,
    },
  });
  assert.equal(merged.updatedAt, now + 100);
});
