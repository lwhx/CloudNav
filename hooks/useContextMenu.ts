import React, { useCallback, useState } from 'react';
import { LinkItem } from '../types';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  link: LinkItem | null;
}

interface QRCodeModalState {
  isOpen: boolean;
  url: string;
  title: string;
}

interface UseContextMenuOptions {
  isBatchEditMode: boolean;
  requireAuth: () => boolean;
  onEditLink: (link: LinkItem) => void;
  onDeleteLink: (linkId: string) => void;
  onTogglePin: (link: LinkItem) => void;
}

const INITIAL_CONTEXT_MENU: ContextMenuState = {
  isOpen: false,
  position: { x: 0, y: 0 },
  link: null,
};

const INITIAL_QR_CODE_MODAL: QRCodeModalState = {
  isOpen: false,
  url: '',
  title: '',
};

export const useContextMenu = (options: UseContextMenuOptions) => {
  const { isBatchEditMode, requireAuth, onEditLink, onDeleteLink, onTogglePin } = options;

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(INITIAL_CONTEXT_MENU);
  const [qrCodeModal, setQrCodeModal] = useState<QRCodeModalState>(INITIAL_QR_CODE_MODAL);

  const closeContextMenu = useCallback(() => {
    setContextMenu(INITIAL_CONTEXT_MENU);
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent, link: LinkItem) => {
    event.preventDefault();
    event.stopPropagation();
    if (isBatchEditMode) return;
    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      link,
    });
  }, [isBatchEditMode]);

  const copyLinkToClipboard = useCallback(() => {
    if (!contextMenu.link) return;
    navigator.clipboard.writeText(contextMenu.link.url)
      .then(() => {
        console.log('链接已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制链接失败:', err);
      });
    closeContextMenu();
  }, [contextMenu.link, closeContextMenu]);

  const showQRCode = useCallback(() => {
    if (!contextMenu.link) return;
    setQrCodeModal({
      isOpen: true,
      url: contextMenu.link.url,
      title: contextMenu.link.title,
    });
    closeContextMenu();
  }, [contextMenu.link, closeContextMenu]);

  const editLinkFromContextMenu = useCallback(() => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    onEditLink(contextMenu.link);
    closeContextMenu();
  }, [contextMenu.link, requireAuth, onEditLink, closeContextMenu]);

  const deleteLinkFromContextMenu = useCallback(() => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    if (window.confirm(`确定要删除"${contextMenu.link.title}"吗？`)) {
      onDeleteLink(contextMenu.link.id);
    }
    closeContextMenu();
  }, [contextMenu.link, requireAuth, onDeleteLink, closeContextMenu]);

  const togglePinFromContextMenu = useCallback(() => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    onTogglePin(contextMenu.link);
    closeContextMenu();
  }, [contextMenu.link, requireAuth, onTogglePin, closeContextMenu]);

  const closeQrCodeModal = useCallback(() => {
    setQrCodeModal(INITIAL_QR_CODE_MODAL);
  }, []);

  return {
    contextMenu,
    qrCodeModal,
    handleContextMenu,
    closeContextMenu,
    copyLinkToClipboard,
    showQRCode,
    editLinkFromContextMenu,
    deleteLinkFromContextMenu,
    togglePinFromContextMenu,
    closeQrCodeModal,
  };
};
