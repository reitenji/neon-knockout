import type { MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import type { GamePresentationBridge } from '../game/GamePresentationBridge.js';

export type HudSnapshotStore = Readonly<{
  getSnapshot: () => MatchSnapshot | null;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}>;

function scoresChanged(previous: MatchSnapshot | null, next: MatchSnapshot): boolean {
  if (!previous) return true;
  const playerIds = new Set([...Object.keys(previous.scores), ...Object.keys(next.scores)]);
  for (const playerId of playerIds) {
    if (previous.scores[playerId] !== next.scores[playerId]) return true;
  }
  return false;
}

function playerIdentityChanged(previous: readonly MatchPlayer[], next: readonly MatchPlayer[]): boolean {
  if (previous.length !== next.length) return true;
  return previous.some((player, index) => {
    const nextPlayer = next[index];
    return player.playerId !== nextPlayer.playerId ||
      player.name !== nextPlayer.name ||
      player.chassis !== nextPlayer.chassis ||
      player.accent !== nextPlayer.accent;
  });
}

function structuralHudChanged(previous: MatchSnapshot | null, next: MatchSnapshot): boolean {
  return !previous || previous.phase !== next.phase ||
    previous.winnerPlayerId !== next.winnerPlayerId ||
    previous.resultReason !== next.resultReason ||
    scoresChanged(previous, next) ||
    playerIdentityChanged(previous.players, next.players);
}

export function createHudSnapshotStore(
  bridge: GamePresentationBridge,
  intervalMs = 50
): HudSnapshotStore {
  const listeners = new Set<() => void>();
  let snapshot = bridge.getSnapshot();
  let pendingSnapshot: MatchSnapshot | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeBridge: (() => void) | null = null;

  const cancelPending = (): void => {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingSnapshot = null;
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const publishDeferred = (): void => {
    pendingTimer = null;
    if (!pendingSnapshot) return;
    snapshot = pendingSnapshot;
    pendingSnapshot = null;
    notify();
  };

  const receiveSnapshot = (next: MatchSnapshot): void => {
    if (structuralHudChanged(snapshot, next)) {
      cancelPending();
      snapshot = next;
      notify();
      return;
    }
    pendingSnapshot = next;
    if (pendingTimer === null) pendingTimer = setTimeout(publishDeferred, intervalMs);
  };

  const stopBridgeSubscription = (): void => {
    unsubscribeBridge?.();
    unsubscribeBridge = null;
    cancelPending();
  };

  const ensureBridgeSubscription = (): void => {
    if (unsubscribeBridge) return;
    snapshot = bridge.getSnapshot();
    unsubscribeBridge = bridge.subscribeSnapshot(receiveSnapshot);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      ensureBridgeSubscription();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopBridgeSubscription();
      };
    },
    dispose: stopBridgeSubscription
  };
}
