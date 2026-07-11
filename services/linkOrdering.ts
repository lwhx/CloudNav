import { arrayMove } from '@dnd-kit/sortable';
import { LinkItem } from '../types';

export const sortCategoryLinks = (links: LinkItem[]) => [...links].sort((left, right) => {
  if (!!left.pinned !== !!right.pinned) return left.pinned ? -1 : 1;
  if (left.pinned && right.pinned) {
    return (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return (left.order ?? left.createdAt) - (right.order ?? right.createdAt);
});

export const reorderCategoryLinks = (
  links: LinkItem[],
  categoryId: string,
  activeId: string,
  overId: string,
) => {
  const categoryLinks = sortCategoryLinks(links.filter(link => !link.deletedAt && link.categoryId === categoryId));
  const activeIndex = categoryLinks.findIndex(link => link.id === activeId);
  const overIndex = categoryLinks.findIndex(link => link.id === overId);
  if (activeIndex === -1 || overIndex === -1) return links;

  const activeLink = categoryLinks[activeIndex];
  const overLink = categoryLinks[overIndex];
  if (!!activeLink.pinned !== !!overLink.pinned) return links;

  const sameTypeLinks = categoryLinks.filter(link => !!link.pinned === !!activeLink.pinned);
  const sameTypeActiveIndex = sameTypeLinks.findIndex(link => link.id === activeId);
  const sameTypeOverIndex = sameTypeLinks.findIndex(link => link.id === overId);
  const reordered = arrayMove(sameTypeLinks, sameTypeActiveIndex, sameTypeOverIndex);
  const positionById = new Map(reordered.map((link, index) => [link.id, index]));

  return links.map(link => {
    const position = positionById.get(link.id);
    if (position === undefined) return link;
    return link.pinned
      ? { ...link, pinnedOrder: position }
      : { ...link, order: position };
  });
};
