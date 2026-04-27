import { useCallback, useEffect, useRef, useState } from 'react';

interface ThemeTransition {
  visible: boolean;
  x: number;
  y: number;
  radius: number;
  targetDark: boolean;
}

export const useTheme = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [themeTransition, setThemeTransition] = useState<ThemeTransition>({
    visible: false,
    x: 0,
    y: 0,
    radius: 0,
    targetDark: false,
  });
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeTransitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (themeTransitionTimerRef.current) {
        window.clearTimeout(themeTransitionTimerRef.current);
      }
    };
  }, []);

  const applyThemeMode = useCallback((newMode: boolean) => {
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const newMode = !darkMode;
    const rect = themeButtonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
    const y = rect ? rect.top + rect.height / 2 : 32;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    if (themeTransitionTimerRef.current) {
      window.clearTimeout(themeTransitionTimerRef.current);
    }

    setThemeTransition({
      visible: true,
      x,
      y,
      radius: 0,
      targetDark: newMode,
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setThemeTransition({
          visible: true,
          x,
          y,
          radius,
          targetDark: newMode,
        });
      });
    });

    themeTransitionTimerRef.current = window.setTimeout(() => {
      applyThemeMode(newMode);
      setThemeTransition(prev => ({
        ...prev,
        visible: false,
        radius: 0,
      }));
      themeTransitionTimerRef.current = null;
    }, 620);
  }, [darkMode, applyThemeMode]);

  return {
    darkMode,
    themeTransition,
    themeButtonRef,
    toggleTheme,
  };
};
