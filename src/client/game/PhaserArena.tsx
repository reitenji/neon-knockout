import { useEffect, useRef } from 'react';
import type { GamePresentationBridge, NeonGameFactory } from './GamePresentationBridge.js';
import { scopeBridgeToPlayer } from './GamePresentationBridge.js';

type PhaserArenaProps = Readonly<{
  bridge: GamePresentationBridge;
  localPlayerId: string;
  createGame?: NeonGameFactory;
  reducedMotion?: boolean;
}>;

export function PhaserArena({
  bridge,
  localPlayerId,
  createGame,
  reducedMotion
}: PhaserArenaProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = reducedMotion ?? (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const scopedBridge = scopeBridgeToPlayer(bridge, localPlayerId);
    let disposed = false;
    let game: ReturnType<NeonGameFactory> | null = null;
    const mount = async (): Promise<void> => {
      const factory = createGame ?? (await import('./phaser/createNeonGame.js')).createNeonGame;
      if (disposed) return;
      game = factory(parent, scopedBridge, { reducedMotion: prefersReducedMotion });
    };
    void mount();
    return () => {
      disposed = true;
      game?.destroy(true);
      game = null;
    };
  }, [bridge, createGame, localPlayerId, prefersReducedMotion]);

  return (
    <section className="screen game-screen" aria-label="Neon Knockout maçı">
      <div
        ref={parentRef}
        className="game-stage tech-frame"
        role="img"
        aria-label="Neon Knockout oyun alanı"
        onContextMenu={(event) => event.preventDefault()}
      />
    </section>
  );
}
