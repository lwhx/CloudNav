import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LinkItem, SiteSettings } from '../../types';

interface SortableLinkCardProps {
  link: LinkItem;
  siteSettings: SiteSettings;
  isSortingMode: boolean;
  isSortingPinned: boolean;
}

const SortableLinkCard = ({ link, siteSettings, isSortingMode, isSortingPinned }: SortableLinkCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.id });

  const isDetailedView = siteSettings.cardStyle === 'detailed';
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative transition-all duration-200 cursor-grab active:cursor-grabbing min-w-0 max-w-full overflow-hidden hover:shadow-lg hover:shadow-green-100/50 dark:hover:shadow-green-900/20 ${
        isSortingMode || isSortingPinned
          ? 'bg-green-20 dark:bg-green-900/30 border-green-200 dark:border-green-800'
          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
      } ${isDragging ? 'shadow-2xl scale-105' : ''} ${
        isDetailedView
          ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px] hover:border-green-400 dark:hover:border-green-500'
          : 'flex items-center rounded-xl border shadow-sm hover:border-green-300 dark:hover:border-green-600'
      }`}
      {...attributes}
      {...listeners}
    >
      <div className={`flex flex-1 min-w-0 overflow-hidden ${isDetailedView ? 'flex-col' : 'items-center gap-3'}`}>
        <div className={`flex items-center gap-3 mb-2 ${isDetailedView ? '' : 'w-full'}`}>
          <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
            isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
          }`}>
            {link.icon ? <img src={link.icon} alt="" className="w-5 h-5"/> : link.title.charAt(0)}
          </div>
          <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
            isDetailedView ? 'text-base' : 'text-sm font-medium text-slate-800 dark:text-slate-200'
          }`} title={link.title}>
            {link.title}
          </h3>
        </div>
        {isDetailedView && link.description && (
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
            {link.description}
          </p>
        )}
      </div>
    </div>
  );
};

export default SortableLinkCard;
