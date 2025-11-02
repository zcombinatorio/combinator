'use client';

import { createContext, useContext, useState, ReactNode, useEffect, useMemo, useCallback } from 'react';

export interface DynamicTab {
  id: string;
  type: 'history' | 'holders' | 'burn' | 'transfer' | 'presale' | 'vesting';
  tokenAddress: string;
  tokenSymbol: string;
  originRoute: string;
}

interface TabContextType {
  dynamicTabs: DynamicTab[];
  addTab: (type: 'history' | 'holders' | 'burn' | 'transfer' | 'presale' | 'vesting', tokenAddress: string, tokenSymbol: string, originRoute: string) => void;
  closeTab: (id: string) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const STORAGE_KEY = 'zc-dynamic-tabs';

export function TabProvider({ children }: { children: ReactNode }) {
  const [dynamicTabs, setDynamicTabs] = useState<DynamicTab[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Restore tabs from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.dynamicTabs && Array.isArray(parsed.dynamicTabs)) {
          // Migrate old tabs without originRoute to have default /portfolio origin
          const migratedTabs = parsed.dynamicTabs.map((tab: any) => ({
            ...tab,
            originRoute: tab.originRoute || '/portfolio'
          }));
          setDynamicTabs(migratedTabs);
        }
      }
    } catch (error) {
      console.error('Failed to restore tabs from localStorage:', error);
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Save tabs to localStorage (debounced via setTimeout)
  useEffect(() => {
    if (!isInitialized) return;

    const timeoutId = setTimeout(() => {
      try {
        const data = { dynamicTabs };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        console.error('Failed to save tabs to localStorage:', error);
      }
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [dynamicTabs, isInitialized]);

  const addTab = useCallback((type: 'history' | 'holders' | 'burn' | 'transfer' | 'presale' | 'vesting', tokenAddress: string, tokenSymbol: string, originRoute: string) => {
    const id = `${type}-${tokenAddress}`;

    setDynamicTabs(prev => {
      // Check if tab already exists
      const existingTab = prev.find(tab => tab.id === id);

      if (existingTab) {
        // Tab already exists, just return current state
        // Navigation will be handled by the caller
        return prev;
      } else {
        // Create new tab
        const newTab: DynamicTab = {
          id,
          type,
          tokenAddress,
          tokenSymbol,
          originRoute
        };
        return [...prev, newTab];
      }
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setDynamicTabs(prev => prev.filter(tab => tab.id !== id));
  }, []);

  return (
    <TabContext.Provider value={{ dynamicTabs, addTab, closeTab }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabContext() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error('useTabContext must be used within a TabProvider');
  }
  return context;
}
