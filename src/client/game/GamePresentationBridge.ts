import type Phaser from 'phaser';
import type { GameEvent, InputFrame, MatchSnapshot } from '../../shared/model.js';

export interface GamePresentationBridge {
  getSnapshot(): MatchSnapshot | null;
  isConnected(): boolean;
  subscribeSnapshot(listener: (snapshot: MatchSnapshot) => void): () => void;
  subscribeConnected(listener: (connected: boolean) => void): () => void;
  subscribeEvent(listener: (event: GameEvent) => void): () => void;
  subscribeMuted(listener: (muted: boolean) => void): () => void;
  sendInput(frame: InputFrame): void;
}

export type NeonGameFactory = (
  parent: HTMLElement,
  bridge: GamePresentationBridge,
  options?: Readonly<{ reducedMotion?: boolean }>
) => Pick<Phaser.Game, 'destroy'>;

const LOCAL_PLAYER_ID = Symbol('localPlayerId');

type ScopedBridge = GamePresentationBridge & { readonly [LOCAL_PLAYER_ID]?: string };

export function scopeBridgeToPlayer(bridge: GamePresentationBridge, localPlayerId: string): GamePresentationBridge {
  return Object.assign(Object.create(bridge) as ScopedBridge, { [LOCAL_PLAYER_ID]: localPlayerId });
}

export function localPlayerIdFromBridge(bridge: GamePresentationBridge): string | null {
  return (bridge as ScopedBridge)[LOCAL_PLAYER_ID] ?? null;
}
