import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchSnapshot } from '../../shared/model.js';
import type { GamePresentationBridge, NeonGameFactory } from './GamePresentationBridge.js';
import { PhaserArena } from './PhaserArena.js';

function bridge(): GamePresentationBridge & { snapshotListeners: Set<(snapshot: MatchSnapshot) => void> } {
  const snapshotListeners = new Set<(snapshot: MatchSnapshot) => void>();
  return {
    snapshotListeners,
    getSnapshot: () => null,
    isConnected: () => true,
    subscribeSnapshot(listener) { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
    subscribeConnected() { return () => undefined; },
    subscribeEvent() { return () => undefined; },
    subscribeMuted() { return () => undefined; },
    sendInput() { return undefined; }
  };
}

describe('PhaserArena', () => {
  afterEach(cleanup);

  it('creates one game for a stable mount and destroys it exactly once with removeCanvas=true', () => {
    const presentation = bridge();
    const destroy = vi.fn();
    const factory = vi.fn<NeonGameFactory>((_parent, receivedBridge) => {
      const unsubscribe = receivedBridge.subscribeSnapshot(() => undefined);
      return { destroy(removeCanvas?: boolean) { unsubscribe(); destroy(removeCanvas); } };
    });
    const view = render(<PhaserArena bridge={presentation} localPlayerId="p-local" createGame={factory} reducedMotion />);

    expect(factory).toHaveBeenCalledOnce();
    expect(presentation.snapshotListeners).toHaveLength(1);
    view.rerender(<PhaserArena bridge={presentation} localPlayerId="p-local" createGame={factory} reducedMotion />);
    expect(factory).toHaveBeenCalledOnce();
    expect(presentation.snapshotListeners).toHaveLength(1);

    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledWith(true);
    expect(presentation.snapshotListeners).toHaveLength(0);
  });

  it('suppresses the context menu inside the arena without changing the rest of the document', () => {
    render(<PhaserArena bridge={bridge()} localPlayerId="p-local" createGame={() => ({ destroy() {} })} />);
    const arena = screen.getByLabelText('Neon Knockout oyun alanı');
    const outside = document.createElement('button');
    document.body.append(outside);
    expect(fireEvent.contextMenu(arena)).toBe(false);
    expect(fireEvent.contextMenu(outside)).toBe(true);
  });
});
