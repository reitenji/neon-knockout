import type { MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { PredictionBuffer, type PlayerPresentation } from '../prediction.js';
import type { ArenaInput } from './ArenaInput.js';

const acceptsInput = (snapshot: MatchSnapshot): boolean =>
  snapshot.phase === 'REGULATION' || snapshot.phase === 'SUDDEN_DEATH';

function playerById(snapshot: MatchSnapshot, playerId: string): MatchPlayer | null {
  return snapshot.players.find((player) => player.playerId === playerId) ?? null;
}

export class ArenaSession {
  private readonly prediction: PredictionBuffer;
  private readonly unsubscribers: Array<() => void> = [];
  private latestSnapshot: MatchSnapshot | null = null;
  private localPresentation: PlayerPresentation | null = null;
  private connected = false;
  private inputSequence = 0;
  private started = false;
  private disposed = false;

  constructor(
    private readonly bridge: GamePresentationBridge,
    private readonly localPlayerId: string,
    private readonly input: ArenaInput,
    private readonly now: () => number,
    private readonly onSnapshot: (snapshot: MatchSnapshot, receivedAtMs: number) => void = () => undefined
  ) {
    this.prediction = new PredictionBuffer(localPlayerId);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.connected = this.bridge.isConnected();
    const initial = this.bridge.getSnapshot();
    if (initial) this.acceptSnapshot(initial);
    if (!this.connected) this.releaseHeldInput();
    this.unsubscribers.push(
      this.bridge.subscribeSnapshot((snapshot) => this.acceptSnapshot(snapshot)),
      this.bridge.subscribeConnected((connected) => this.acceptConnection(connected))
    );
  }

  step(elapsedMs: number): PlayerPresentation | null {
    if (!this.started || this.disposed || !this.connected || !this.latestSnapshot) return this.localPresentation;
    const localPlayer = playerById(this.latestSnapshot, this.localPlayerId);
    if (!localPlayer || !acceptsInput(this.latestSnapshot)) {
      this.releaseHeldInput();
      return this.localPresentation;
    }
    const visibleOrigin = this.localPresentation?.position ?? localPlayer.position;
    const frame = this.input.sample(this.inputSequence, visibleOrigin, this.now());
    if (!frame) return this.localPresentation;
    this.inputSequence += 1;
    this.localPresentation = this.prediction.predict(
      frame,
      localPlayer,
      elapsedMs,
      this.latestSnapshot.platformProgress
    );
    this.bridge.sendInput(frame);
    return this.localPresentation;
  }

  getLocalPresentation(): PlayerPresentation | null {
    return this.localPresentation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.input.dispose();
    this.prediction.reset();
  }

  private acceptConnection(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    if (!connected) this.releaseHeldInput();
  }

  private acceptSnapshot(snapshot: MatchSnapshot): void {
    this.latestSnapshot = snapshot;
    this.onSnapshot(snapshot, this.now());
    const localPlayer = playerById(snapshot, this.localPlayerId);
    if (!localPlayer) {
      this.prediction.reset();
      this.localPresentation = null;
      return;
    }
    this.inputSequence = Math.max(this.inputSequence, localPlayer.lastProcessedInputSeq + 1);
    this.localPresentation = this.prediction.reconcile(
      localPlayer,
      1_000 / 60,
      snapshot.platformProgress
    );
  }

  private releaseHeldInput(): void {
    this.input.clearHeld();
    const localPlayer = this.latestSnapshot ? playerById(this.latestSnapshot, this.localPlayerId) : null;
    this.prediction.reset(localPlayer ?? undefined);
    this.localPresentation = localPlayer
      ? {
          position: localPlayer.position,
          velocity: localPlayer.velocity,
          facing: localPlayer.facing,
          actionStart: null
        }
      : null;
  }
}
