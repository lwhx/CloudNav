import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORY_UNLOCK_HEADER,
  createCategoryUnlockToken,
  getAuthorizedCategoryIds,
  mergeQuickAddInbox,
} from '../functions/api/storage-shared';

class MemoryKv {
  private values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';
    return {
      keys: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })),
      list_complete: true,
    };
  }
}

const createEnv = () => ({ CLOUDNAV_KV: new MemoryKv(), PASSWORD: 'test' });

test('category IDs cannot be forged through the unlock header', async () => {
  const env = createEnv();
  const request = new Request('https://example.com/api/storage', {
    headers: { [CATEGORY_UNLOCK_HEADER]: 'private-category' },
  });

  assert.deepEqual([...await getAuthorizedCategoryIds(request, env)], []);
});

test('server-issued category unlock tokens authorize only their category', async () => {
  const env = createEnv();
  const { token } = await createCategoryUnlockToken(env, 'private-category');
  const request = new Request('https://example.com/api/storage', {
    headers: { [CATEGORY_UNLOCK_HEADER]: token },
  });

  assert.deepEqual([...await getAuthorizedCategoryIds(request, env)], ['private-category']);
});

test('quick-add inbox preserves groups and merges every queued link', async () => {
  const env = createEnv();
  await env.CLOUDNAV_KV.put('quick-add:1:first', JSON.stringify({ id: 'first', title: 'First' }));
  await env.CLOUDNAV_KV.put('quick-add:2:second', JSON.stringify({ id: 'second', title: 'Second' }));

  const result = await mergeQuickAddInbox(env, {
    links: [{ id: 'existing' }],
    categoryGroups: [{ id: 'group-1' }],
  });

  assert.deepEqual(result.payload.categoryGroups, [{ id: 'group-1' }]);
  assert.deepEqual(result.payload.links.map(link => link.id), ['existing', 'first', 'second']);
  assert.equal(result.consumedKeys.length, 2);
});
