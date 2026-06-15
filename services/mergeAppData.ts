import {
  APP_DATA_VERSION,
  AppDataPayload,
  Category,
  CategoryGroup,
  LinkItem,
} from '../types';

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Effective change-time of a link.
 *
 * Falls back to `createdAt` (always present) so that even when `updatedAt` is
 * not recorded, a freshly added link — whose `createdAt` is recent — is never
 * treated as older than a stale cloud snapshot that simply omits it.
 */
const linkMtime = (link: LinkItem): number => {
  if (typeof link.updatedAt === 'number' && link.updatedAt > 0) return link.updatedAt;
  return typeof link.createdAt === 'number' ? link.createdAt : 0;
};

/**
 * Effective change-time of a category / group.
 * Categories/groups lack a dedicated mtime; treat the absence of `deletedAt` as
 * "alive" and use `deletedAt` as the deletion timestamp when present.
 */
const entityMtime = (entity: { deletedAt?: number }): number => {
  return typeof entity.deletedAt === 'number' && entity.deletedAt > 0 ? entity.deletedAt : 1;
};

const isExpiredTrash = (deletedAt?: number) => {
  return typeof deletedAt === 'number' && deletedAt > 0 && Date.now() - deletedAt > TRASH_RETENTION_MS;
};

interface MergeSide {
  links?: LinkItem[];
  categories?: Category[];
  categoryGroups?: CategoryGroup[];
  updatedAt?: number;
}

/**
 * Merge local and cloud app-data into a single dataset that preserves every
 * non-deleted record from either side.
 *
 * The previous implementation chose "local OR cloud" based on comparing whole-
 * envelope `updatedAt` timestamps. That was unsafe because:
 *  - Cloudflare KV is eventually consistent: a read right after a write can
 *    return the previous value (older content, possibly an older or equal
 *    `updatedAt`), so a freshly added local link could be silently dropped.
 *  - Envelope `updatedAt` is generated client-side with `Date.now()` and does
 *    not describe per-record freshness.
 *
 * This merge is ID-based instead:
 *  - links/categories/groups are unioned by `id`;
 *  - for records present on both sides, the side with the newer per-record
 *    timestamp wins (deletedAt for tombstones, linkMtime for links);
 *  - a tombstone only wins if it is newer than the other side's record, so a
 *    newer local edit correctly "undeletes";
 *  - expired trash (>30d) is dropped.
 *
 * As a result, a local-only link added just before refresh survives even when
 * the cloud snapshot is stale — the original "link disappears after refresh"
 * bug.
 */
export const mergeAppData = ({ local, cloud }: { local: MergeSide; cloud: MergeSide }): AppDataPayload => {
  const localLinks = Array.isArray(local.links) ? local.links : [];
  const cloudLinks = Array.isArray(cloud.links) ? cloud.links : [];
  const localCats = Array.isArray(local.categories) ? local.categories : [];
  const cloudCats = Array.isArray(cloud.categories) ? cloud.categories : [];
  const localGroups = Array.isArray(local.categoryGroups) ? local.categoryGroups : [];
  const cloudGroups = Array.isArray(cloud.categoryGroups) ? cloud.categoryGroups : [];

  // --- links: union by id, per-record newer wins ---
  const linkById = new Map<string, LinkItem>();
  for (const link of [...localLinks, ...cloudLinks]) {
    if (!link || !link.id) continue;
    if (isExpiredTrash(link.deletedAt)) continue; // drop old trash
    const existing = linkById.get(link.id);
    if (!existing) {
      linkById.set(link.id, link);
    } else {
      const existingMtime = linkMtime(existing);
      const incomingMtime = linkMtime(link);
      // A tombstone (deletedAt) overrides mtime comparison only when it is the
      // newer event. If a real edit came in later, its mtime will be larger and
      // it correctly wins (undelete).
      const existingDeletedAt = typeof existing.deletedAt === 'number' ? existing.deletedAt : 0;
      const incomingDeletedAt = typeof link.deletedAt === 'number' ? link.deletedAt : 0;
      const existingEffective = Math.max(existingMtime, existingDeletedAt);
      const incomingEffective = Math.max(incomingMtime, incomingDeletedAt);
      if (incomingEffective >= existingEffective) {
        linkById.set(link.id, link);
      }
    }
  }

  // --- categories: union by id ---
  const catById = new Map<string, Category>();
  for (const cat of [...localCats, ...cloudCats]) {
    if (!cat || !cat.id) continue;
    if (isExpiredTrash(cat.deletedAt)) continue;
    const existing = catById.get(cat.id);
    if (!existing || entityMtime(cat) >= entityMtime(existing)) {
      catById.set(cat.id, cat);
    }
  }

  // --- category groups: union by id ---
  const groupById = new Map<string, CategoryGroup>();
  for (const group of [...localGroups, ...cloudGroups]) {
    if (!group || !group.id) continue;
    if (isExpiredTrash(group.deletedAt)) continue;
    const existing = groupById.get(group.id);
    if (!existing || entityMtime(group) >= entityMtime(existing)) {
      groupById.set(group.id, group);
    }
  }

  const links = Array.from(linkById.values());
  const categories = Array.from(catById.values());
  const categoryGroups = Array.from(groupById.values());

  const maxUpdatedAt = Math.max(
    typeof local.updatedAt === 'number' ? local.updatedAt : 0,
    typeof cloud.updatedAt === 'number' ? cloud.updatedAt : 0,
  );

  return {
    links,
    categories,
    categoryGroups,
    version: APP_DATA_VERSION,
    updatedAt: maxUpdatedAt,
  };
};
