import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import type { GamePresentationBridge } from '../game/GamePresentationBridge.js';
import { PhaserArena } from '../game/PhaserArena.js';

const idleAction = { kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0 } as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p-local',
    name: 'Ada',
    chassis: 'RIFT',
    accent: 0,
    position: { x: 640, y: 360 },
    velocity: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    overload: 84,
    lastProcessedInputSeq: 0,
    action: { kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: 350 },
    dashRemainingMs: 0,
    dashCooldownRemainingMs: 550,
    hitstunRemainingMs: 0,
    respawnRemainingMs: 0,
    protectionRemainingMs: 0,
    stats: { knockouts: 2, falls: 1, landedHits: 4, completedAttacks: 6 },
    ...overrides
  };
}

function snapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  const local = player();
  const rival = player({
    playerId: 'p-rival',
    name: 'Linus',
    chassis: 'BASTION',
    accent: 1,
    overload: 22,
    action: idleAction,
    stats: { knockouts: 4, falls: 0, landedHits: 8, completedAttacks: 10 }
  });
  return {
    tick: 12,
    phase: 'COUNTDOWN',
    remainingMs: 2_200,
    platformProgress: 0,
    scores: { 'p-local': 2, 'p-rival': 4 },
    players: [local, rival],
    winnerPlayerId: null,
    resultReason: null,
    ...overrides
  };
}

class PresentationBridge implements GamePresentationBridge {
  current: MatchSnapshot | null = snapshot();
  connected = true;
  readonly snapshotListeners = new Set<(value: MatchSnapshot) => void>();
  readonly connectionListeners = new Set<(connected: boolean) => void>();

  getSnapshot = (): MatchSnapshot | null => this.current;
  isConnected = (): boolean => this.connected;
  subscribeSnapshot = (listener: (value: MatchSnapshot) => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };
  subscribeConnected = (listener: (connected: boolean) => void): (() => void) => {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  };
  subscribeEvent = (): (() => void) => () => undefined;
  subscribeMuted = (): (() => void) => () => undefined;
  sendInput = (): void => undefined;

  publish(next: MatchSnapshot): void {
    this.current = next;
    for (const listener of this.snapshotListeners) listener(next);
  }

  setConnected(next: boolean): void {
    this.connected = next;
    for (const listener of this.connectionListeners) listener(next);
  }
}

describe('MatchHud', () => {
  afterEach(cleanup);

  it('makes countdown, ranking, local combat state, connection, and every control discoverable', () => {
    const bridge = new PresentationBridge();
    render(
      <PhaserArena
        bridge={bridge}
        localPlayerId="p-local"
        createGame={() => ({ destroy() {} })}
        reducedMotion
      />
    );

    expect(screen.getByRole('complementary', { name: 'Maç bilgileri' })).toBeVisible();
    expect(screen.getByRole('timer', { name: 'Kalan süre' })).toHaveTextContent('00:03');
    expect(screen.getByRole('status', { name: 'Geri sayım' })).toHaveTextContent('3');

    const ranking = screen.getByRole('list', { name: 'Skor sıralaması' });
    const rows = within(ranking).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Linus4');
    expect(rows[1]).toHaveTextContent('AdaSen2');

    expect(screen.getByRole('meter', { name: 'Overload' })).toHaveAttribute('aria-valuenow', '84');
    expect(screen.getByText('84%')).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Dash dolumu' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Ağır saldırı %50')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Bağlantı durumu' })).toHaveTextContent('Bağlı');

    const controls = screen.getByLabelText('Kontroller');
    expect(controls).toHaveTextContent('WASD');
    expect(controls).toHaveTextContent('Oklar');
    expect(controls).toHaveTextContent('Sol tık');
    expect(controls).toHaveTextContent('Sağ tık');
    expect(controls).toHaveTextContent('Boşluk');
  });

  it('tracks live phase, combat, and transport changes without remounting the arena', () => {
    const bridge = new PresentationBridge();
    const view = render(
      <PhaserArena bridge={bridge} localPlayerId="p-local" createGame={() => ({ destroy() {} })} reducedMotion />
    );

    act(() => bridge.publish(snapshot({
      phase: 'REGULATION',
      remainingMs: 119_650,
      players: [player({ action: idleAction, overload: 120, dashCooldownRemainingMs: 0 })],
      scores: { 'p-local': 3 }
    })));

    expect(screen.getByRole('status', { name: 'Raunt başlangıcı' })).toHaveTextContent('FIGHT');
    expect(screen.getByRole('timer', { name: 'Kalan süre' })).toHaveTextContent('02:00');
    expect(screen.getByText('Hazır')).toBeVisible();
    expect(screen.getByText('Beklemede')).toBeVisible();

    act(() => bridge.setConnected(false));
    expect(screen.getByRole('status', { name: 'Bağlantı durumu' })).toHaveTextContent('Bağlantı kesildi');

    view.unmount();
    expect(bridge.snapshotListeners).toHaveLength(0);
    expect(bridge.connectionListeners).toHaveLength(0);
  });

  it('shows the short authoritative respawn wait without making the knockout feel longer', () => {
    const bridge = new PresentationBridge();
    bridge.current = snapshot({
      phase: 'REGULATION',
      remainingMs: 90_000,
      players: [player({
        action: { kind: 'RESPAWNING', phase: 'IDLE', comboStep: 0, chargeMs: 0 },
        respawnRemainingMs: 650
      })]
    });

    render(<PhaserArena bridge={bridge} localPlayerId="p-local" createGame={() => ({ destroy() {} })} reducedMotion />);

    expect(screen.getByRole('status', { name: 'Aksiyon durumu' })).toHaveTextContent('Geri dönüş 0.7 sn');
  });
});
