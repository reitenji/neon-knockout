import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import type { GamePresentationBridge } from '../game/GamePresentationBridge.js';
import { PhaserArena } from '../game/PhaserArena.js';
import { MatchHud } from './MatchHud.js';

const idleAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
} as const;

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
    action: { ...idleAction, kind: 'HEAVY', phase: 'WINDUP', chargeMs: 350 },
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
    pulses: [],
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
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
        action: { ...idleAction, kind: 'RESPAWNING' },
        respawnRemainingMs: 650
      })]
    });

    render(<PhaserArena bridge={bridge} localPlayerId="p-local" createGame={() => ({ destroy() {} })} reducedMotion />);

    expect(screen.getByRole('status', { name: 'Aksiyon durumu' })).toHaveTextContent('Geri dönüş 0.7 sn');
  });

  it('shows sudden death once for 1100ms despite repeated snapshots while retaining the phase header', () => {
    const bridge = new PresentationBridge();
    render(
      <PhaserArena bridge={bridge} localPlayerId="p-local" createGame={() => ({ destroy() {} })} reducedMotion />
    );

    act(() => bridge.publish(snapshot({ phase: 'REGULATION', remainingMs: 90_000 })));
    expect(screen.queryByRole('status', { name: 'Raunt durumu' })).not.toBeInTheDocument();

    act(() => bridge.publish(snapshot({ phase: 'SUDDEN_DEATH', remainingMs: 30_000 })));
    expect(screen.getByRole('status', { name: 'Raunt durumu' })).toHaveTextContent('SON VURUŞ');

    act(() => bridge.publish(snapshot({ phase: 'SUDDEN_DEATH', remainingMs: 29_500 })));
    act(() => vi.advanceTimersByTime(1_099));
    expect(screen.getByRole('status', { name: 'Raunt durumu' })).toHaveTextContent('SON VURUŞ');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status', { name: 'Raunt durumu' })).not.toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Kalan süre' }).closest('header')).toHaveTextContent('SON VURUŞ');
  });

  it('keeps paused announcements persistent and clears a pending sudden-death timeout on unmount', () => {
    const bridge = new PresentationBridge();
    bridge.current = snapshot({ phase: 'PAUSED', remainingMs: 30_000 });
    const pausedView = render(<MatchHud bridge={bridge} localPlayerId="p-local" />);

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status', { name: 'Raunt durumu' })).toHaveTextContent('BEKLE');
    pausedView.unmount();

    bridge.current = snapshot({ phase: 'REGULATION', remainingMs: 90_000 });
    const suddenDeathView = render(<MatchHud bridge={bridge} localPlayerId="p-local" />);
    act(() => bridge.publish(snapshot({ phase: 'SUDDEN_DEATH', remainingMs: 30_000 })));
    expect(vi.getTimerCount()).toBe(1);

    suddenDeathView.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runOnlyPendingTimers());
  });
});
