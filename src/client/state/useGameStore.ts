import { useSyncExternalStore } from 'react';
import type { ClientState, GameStore } from './gameStore.js';

export function useGameStore(store: GameStore): ClientState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
