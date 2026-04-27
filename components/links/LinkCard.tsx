import type React from 'react';
import { LinkItem, SiteSettings } from '../../types';

interface LinkCardProps {
  link: LinkItem;
  isSelected: boolean;
  isBatchEditMode: boolean;
  siteSettings: SiteSettings;
  onToggleSelection: (linkId: string) => void;
  onContextMenu: (event: React.MouseEvent, link: LinkItem) => void;
  onEdit: (link: LinkItem, event: React.MouseEvent) => void;
}

const LinkCard = ({
  link,
  isSelected,
  isBatchEditMode,
  siteSettings,
  onToggleSelection,
  onContextMenu,
  onEdit,
}: LinkCardProps) => {
  const isDetailedView = siteSettings.cardStyle === 'detailed';

  const content = (
    <>
      <div className="flex items-center gap-3 w-full">
        <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
          isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
        }`}>
          {link.icon ? <img src={link.icon} alt="" className="w-5 h-5"/> : link.title.charAt(0)}
        </div>
        <h3 className={`truncate overflow-hidden text-ellipsis ${
          isDetailedView ? 'text-base text-slate-900 dark:text-slate-100' : 'text-sm font-medium text-slate-800 dark:text-slate-200'
        }`} title={link.title}>
          {link.title}
        </h3>
      </div>
      {isDetailedView && link.description && (
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
          {link.description}
        </p>
      )}
    </>
  );

  return (
    <div
      className={`group relative transition-all duration-200 hover:shadow-lg hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20 ${
        isSelected
          ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
          : 'bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-slate-200 dark:border-slate-700'
      } ${isBatchEditMode ? 'cursor-pointer' : ''} ${
        isDetailedView
          ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px] hover:border-blue-400 dark:hover:border-blue-500'
          : 'flex items-center justify-between rounded-xl border shadow-sm p-3 hover:border-blue-300 dark:hover:border-blue-600'
      }`}
      onClick={() => isBatchEditMode && onToggleSelection(link.id)}
      onContextMenu={(event) => onContextMenu(event, link)}
    >
      {isBatchEditMode ? (
        <div className={`flex flex-1 min-w-0 overflow-hidden h-full ${isDetailedView ? 'flex-col' : 'items-center'}`}>
          {content}
        </div>
      ) : (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex flex-1 min-w-0 overflow-hidden h-full ${isDetailedView ? 'flex-col' : 'items-center'}`}
          title={isDetailedView ? link.url : (link.description || link.url)}
        >
          {content}
          {!isDetailedView && link.description && (
            <div className="tooltip-custom absolute left-0 -top-8 w-max max-w-[200px] bg-black text-white text-xs p-2 rounded opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all z-20 pointer-events-none truncate">
              {link.description}
            </div>
          )}
        </a>
      )}

      {!isBatchEditMode && (
        <div className={`flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50 dark:bg-blue-900/20 backdrop-blur-sm rounded-md p-1 absolute ${
          isDetailedView ? 'top-3 right-3' : 'top-1/2 -translate-y-1/2 right-2'
        }`}>
          <button
            onClick={(event) => onEdit(link, event)}
            className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
            title="编辑"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.65-.07-.97l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.32-.07.64-.07.97c0 .33.03.65.07.97l-2.11 1.63c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.39 1.06.73 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.25 1.17-.59 1.69-.98l2.49 1c.22.08.49 0 .61-.22l2-3.46c.13-.22.07-.49-.12-.64l-2.11-1.63Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default LinkCard;
