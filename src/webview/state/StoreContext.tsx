import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { PanelStoreInstance } from './createStore';
import type { PanelStore } from './types';

const StoreContext = createContext<PanelStoreInstance | null>(null);

export function StoreProvider({ instance, children }: { instance: PanelStoreInstance; children: ReactNode }) {
  return <StoreContext.Provider value={instance}>{children}</StoreContext.Provider>;
}

export function useInstance(): PanelStoreInstance {
  const instance = useContext(StoreContext);
  if (!instance) {
    throw new Error('StoreProvider missing');
  }
  return instance;
}

export function usePanelStore<T>(selector: (s: PanelStore) => T): T {
  return useStore(useInstance().store as StoreApi<PanelStore>, selector);
}

export function useStoreApi(): StoreApi<PanelStore> {
  return useInstance().store as StoreApi<PanelStore>;
}