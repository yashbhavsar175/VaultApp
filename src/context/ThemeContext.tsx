import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';
type ActiveTheme = 'light' | 'dark';

interface ThemeColors {
  background: string;
  card: string;
  text: string;
  subtext: string;
  accent: string;
  border: string;
  input: string;
  error: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  modalOverlay: string;
  shadow: string;
  income: string;
  expense: string;
  investment: string;
  emi: string;
  lent: string;
  borrowed: string;
}

interface Typography {
  h1: { fontSize: number; fontWeight: '700' };
  h2: { fontSize: number; fontWeight: '700' };
  h3: { fontSize: number; fontWeight: '600' };
  body: { fontSize: number; fontWeight: '400' };
  bodyBold: { fontSize: number; fontWeight: '600' };
  caption: { fontSize: number; fontWeight: '400' };
  button: { fontSize: number; fontWeight: '600' };
}

interface Spacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

interface BorderRadius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

interface Shadows {
  sm: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
  md: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
  lg: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

interface ThemeContextType {
  theme: ActiveTheme;
  themeMode: ThemeMode;
  colors: ThemeColors;
  typography: Typography;
  spacing: Spacing;
  borderRadius: BorderRadius;
  shadows: Shadows;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const typography: Typography = {
  h1: { fontSize: 28, fontWeight: '700' },
  h2: { fontSize: 24, fontWeight: '700' },
  h3: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  bodyBold: { fontSize: 16, fontWeight: '600' },
  caption: { fontSize: 14, fontWeight: '400' },
  button: { fontSize: 16, fontWeight: '600' },
};

const spacing: Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

const borderRadius: BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

const lightColors: ThemeColors = {
  background: '#f5f5f5',
  card: '#ffffff',
  text: '#1a1a1a',
  subtext: '#666666',
  accent: '#7c3aed',
  border: '#e0e0e0',
  input: '#f8f8f8',
  error: '#ff4444',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  shadow: '#000000',
  income: '#10b981',
  expense: '#ef4444',
  investment: '#7c3aed',
  emi: '#f59e0b',
  lent: '#06b6d4',
  borrowed: '#ec4899',
};

const darkColors: ThemeColors = {
  background: '#0a0a0f',
  card: '#1a1a2e',
  text: '#ffffff',
  subtext: '#888888',
  accent: '#7c3aed',
  border: '#2a2a3e',
  input: '#1a1a26',
  error: '#ff4444',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  shadow: '#000000',
  income: '#10b981',
  expense: '#ef4444',
  investment: '#7c3aed',
  emi: '#f59e0b',
  lent: '#06b6d4',
  borrowed: '#ec4899',
};

const getShadows = (shadowColor: string): Shadows => ({
  sm: {
    shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
});

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'theme_preference';

// Default theme value for loading state to prevent blank screen flash
const getDefaultThemeValue = (systemColorScheme: 'light' | 'dark' | 'unspecified' | null | undefined): ThemeContextType => {
  // Handle 'unspecified' or null/undefined by defaulting to 'light'
  const activeTheme: ActiveTheme = systemColorScheme === 'dark' ? 'dark' : 'light';
  const colors = activeTheme === 'dark' ? darkColors : lightColors;
  const shadows = getShadows(colors.shadow);
  
  return {
    theme: activeTheme,
    themeMode: 'system',
    colors,
    typography,
    spacing,
    borderRadius,
    shadows,
    setThemeMode: async () => {}, // No-op during loading
  };
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoading, setIsLoading] = useState(true);

  // Determine active theme based on mode and system preference
  const getActiveTheme = (): ActiveTheme => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark' ? 'dark' : 'light';
    }
    return themeMode;
  };

  const theme = getActiveTheme();
  const colors = theme === 'dark' ? darkColors : lightColors;
  const shadows = getShadows(colors.shadow);

  // Load theme preference from AsyncStorage on mount
  useEffect(() => {
    loadThemePreference();
  }, []);

  // Theme automatically updates when systemColorScheme changes
  // because getActiveTheme() is called during render

  const loadThemePreference = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system')) {
        setThemeModeState(savedTheme as ThemeMode);
      }
    } catch (error) {
      console.error('Failed to load theme preference:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('Failed to save theme preference:', error);
    }
  };

  if (isLoading) {
    // Return default theme during loading to prevent blank screen flash
    const defaultThemeValue = getDefaultThemeValue(systemColorScheme);
    return (
      <ThemeContext.Provider value={defaultThemeValue}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, themeMode, colors, typography, spacing, borderRadius, shadows, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
