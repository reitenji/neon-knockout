import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, InputFrame, MatchSnapshot } from '../../shared/model.js';
import type { ClientState, GameStore } from '../state/gameStore.js';
import { GameCanvas } from './GameCanvas.js';

const MATCH: MatchSnapshot = {
  tick: 10,
  phase: 'REGULATION',
  remainingMs: 90_000,
  score: { CYAN: 2, AMBER: 1 },
  players: [
    {
      playerId: 'p-1',
      name: 'Ada',
      team: 'CYAN',
      position: { x: 200, y: 300 },
      carriedCoreId: null,
      lastProcessedInputSeq: 4,
      dashRemainingMs: 0,
      dashCooldownRemainingMs: 900,
      stunRemainingMs: 0,
      stats: { deliveries: 0, tackles: 0 }
    }
  ],
  cores: [],
  winner: null
};

const STATE: ClientState = {
  screen: 'MATCH',
  connectionState: 'connected',
  room: null,
  match: MATCH,
  session: { playerId: 'p-1', roomCode: 'AB2Z', resumeToken: 'token' },
  pendingAction: null,
  lastError: null,
  errorAction: null,
  copyFeedback: 'idle',
  toasts: [],
  soundMuted: false
};

class CanvasStore implements GameStore {
  readonly actions = {
    connect: vi.fn(),
    createRoom: vi.fn(async () => undefined),
    joinRoom: vi.fn(async () => undefined),
    setTeam: vi.fn(async () => undefined),
    setReady: vi.fn(async () => undefined),
    startMatch: vi.fn(async () => undefined),
    copyRoomCode: vi.fn(async () => undefined),
    toggleSound: vi.fn(),
    dismissToast: vi.fn()
  };
  readonly sendInput = vi.fn<(frame: InputFrame) => void>();
  private readonly matchListeners = new Set<(snapshot: MatchSnapshot) => void>();
  private readonly gameEventListeners = new Set<(event: GameEvent) => void>();

  getSnapshot = (): ClientState => STATE;
  getLatestMatch = (): MatchSnapshot | null => MATCH;
  subscribe = (): (() => void) => () => undefined;
  subscribeMatch = (listener: (snapshot: MatchSnapshot) => void): (() => void) => {
    this.matchListeners.add(listener);
    return () => this.matchListeners.delete(listener);
  };
  subscribeGameEvent = (listener: (event: GameEvent) => void): (() => void) => {
    this.gameEventListeners.add(listener);
    return () => this.gameEventListeners.delete(listener);
  };
  dispose = vi.fn();

  emitMatch(snapshot: MatchSnapshot): void {
    for (const listener of this.matchListeners) listener(snapshot);
  }
}

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    void callback;
    ResizeObserverStub.instances.push(this);
  }
}

describe('GameCanvas', () => {
  afterEach(() => {
    cleanup();
    ResizeObserverStub.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('owns one RAF loop, one 30 Hz sender, and one ResizeObserver, then cleans them all', () => {
    const store = new CanvasStore();
    const requestAnimationFrame = vi.fn(() => 41);
    const cancelAnimationFrame = vi.fn();
    const intervalSpy = vi.spyOn(window, 'setInterval').mockReturnValue(73);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);

    const view = render(<GameCanvas store={store} localPlayerId="p-1" />);

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(intervalSpy).toHaveBeenCalledOnce();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000 / 30);
    expect(ResizeObserverStub.instances).toHaveLength(1);
    expect(ResizeObserverStub.instances[0]?.observe).toHaveBeenCalledOnce();

    store.emitMatch({ ...MATCH, tick: 11, remainingMs: 89_950 });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(intervalSpy).toHaveBeenCalledOnce();
    expect(ResizeObserverStub.instances).toHaveLength(1);

    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(clearIntervalSpy).toHaveBeenCalledWith(73);
    expect(ResizeObserverStub.instances[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps accessible score, clock, cooldown, core, ping, and controls outside Canvas', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(window, 'setInterval').mockReturnValue(2);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);

    render(<GameCanvas store={new CanvasStore()} localPlayerId="p-1" />);

    expect(screen.getByLabelText('Skor')).toHaveTextContent('2');
    expect(screen.getByLabelText('Kalan süre')).toHaveTextContent('01:30');
    expect(screen.getByText('HAMLE')).toBeVisible();
    expect(screen.getByText('0.9s')).toBeVisible();
    expect(screen.getByText('ÇEKİRDEK')).toBeVisible();
    expect(screen.getByText('— ms')).toBeVisible();
    expect(screen.getByText('WASD: Hareket')).toBeVisible();
    expect(screen.getByText('SPACE: Hamle')).toBeVisible();
  });
});
