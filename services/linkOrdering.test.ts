import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkItem } from '../types';
import { reorderCategoryLinks, sortCategoryLinks } from './linkOrdering';

const link = (id: string, options: Partial<LinkItem> = {}): LinkItem => ({
  id,
  title: id,
  url: `https://${id}.example.com`,
  categoryId: 'category-a',
  createdAt: 1,
  ...options,
});

test('category display keeps pinned links before regular links', () => {
  const sorted = sortCategoryLinks([
    link('regular', { order: 0 }),
    link('pinned-b', { pinned: true, pinnedOrder: 1 }),
    link('pinned-a', { pinned: true, pinnedOrder: 0 }),
  ]);
  assert.deepEqual(sorted.map(item => item.id), ['pinned-a', 'pinned-b', 'regular']);
});

test('reordering pinned links updates pinnedOrder only', () => {
  const source = [link('pinned-a', { pinned: true, pinnedOrder: 0 }), link('pinned-b', { pinned: true, pinnedOrder: 1 }), link('regular', { order: 4 })];
  const reordered = reorderCategoryLinks(source, 'category-a', 'pinned-a', 'pinned-b');
  assert.deepEqual(sortCategoryLinks(reordered).map(item => item.id), ['pinned-b', 'pinned-a', 'regular']);
  assert.equal(reordered.find(item => item.id === 'regular')?.order, 4);
});

test('reordering regular links does not alter pinned order', () => {
  const source = [link('pinned', { pinned: true, pinnedOrder: 3 }), link('regular-a', { order: 0 }), link('regular-b', { order: 1 })];
  const reordered = reorderCategoryLinks(source, 'category-a', 'regular-a', 'regular-b');
  assert.deepEqual(sortCategoryLinks(reordered).map(item => item.id), ['pinned', 'regular-b', 'regular-a']);
  assert.equal(reordered.find(item => item.id === 'pinned')?.pinnedOrder, 3);
});

test('crossing pinned and regular boundaries is ignored', () => {
  const source = [link('pinned', { pinned: true, pinnedOrder: 0 }), link('regular', { order: 0 })];
  assert.strictEqual(reorderCategoryLinks(source, 'category-a', 'pinned', 'regular'), source);
});
