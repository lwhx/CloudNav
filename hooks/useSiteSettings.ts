import { useCallback, useEffect, useState } from 'react';
import { SiteSettings } from '../types';

const SITE_SETTINGS_KEY = 'cloudnav_site_settings';

const DEFAULT_SITE_SETTINGS: SiteSettings = {
  title: '',
  navTitle: 'CloudNav',
  favicon: '',
  cardStyle: 'detailed',
  requirePasswordOnVisit: false,
  passwordExpiryDays: 7,
};

const createRoundedFavicon = (source: string): Promise<string> => {
  return new Promise((resolve) => {
    if (!source) {
      resolve(source);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64;
        const radius = 14;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(source);
          return;
        }

        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(size - radius, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, size - radius);
        ctx.quadraticCurveTo(size, size, size - radius, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, size - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(source);
      }
    };
    img.onerror = () => resolve(source);
    img.src = source;
  });
};

export const useSiteSettings = () => {
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(() => {
    const saved = localStorage.getItem(SITE_SETTINGS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_SITE_SETTINGS;
  });

  useEffect(() => {
    if (siteSettings.title) {
      document.title = siteSettings.title;
    }

    const updateFavicon = async () => {
      if (!siteSettings.favicon) return;

      const roundedFavicon = await createRoundedFavicon(siteSettings.favicon);
      const existingFavicons = document.querySelectorAll('link[rel="icon"]');
      existingFavicons.forEach(favicon => favicon.remove());

      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = roundedFavicon;
      document.head.appendChild(favicon);
    };

    updateFavicon();
  }, [siteSettings.title, siteSettings.favicon]);

  const handleViewModeChange = useCallback((cardStyle: 'detailed' | 'simple') => {
    setSiteSettings(prev => {
      const newSettings = { ...prev, cardStyle };
      localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  const updateSiteSettings = useCallback((updater: SiteSettings | ((prev: SiteSettings) => SiteSettings)) => {
    setSiteSettings(prev => {
      const newSettings = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  return {
    siteSettings,
    setSiteSettings: updateSiteSettings,
    handleViewModeChange,
  };
};
