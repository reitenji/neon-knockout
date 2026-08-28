import Phaser from 'phaser';
import { ARENA } from '../../../shared/constants.js';
import type { GameEvent, MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { localPlayerIdFromBridge } from '../GamePresentationBridge.js';
import { PredictionBuffer, SnapshotTimeline, interpolateRemotePlayer, type PlayerPresentation } from '../prediction.js';
import { ARENA_SCENE_KEY } from './BootScene.js';
import { ArenaInput, createPhaserInputSource } from './ArenaInput.js';
import { createFighterView, type FighterView } from './FighterView.js';

const INPUT_STEP_MS = 1_000 / 60;

function playerById(snapshot: MatchSnapshot, playerId: string): MatchPlayer | null {
  return snapshot.players.find((player) => player.playerId === playerId) ?? null;
}

function acceptsInput(snapshot: MatchSnapshot | null): boolean {
  return snapshot?.phase === 'REGULATION' || snapshot?.phase === 'SUDDEN_DEATH';
}

export class ArenaScene extends Phaser.Scene {
  private readonly localPlayerId: string | null;
  private readonly timeline = new SnapshotTimeline();
  private readonly views = new Map<string, FighterView>();
  private readonly canonicalEvents: GameEvent[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private prediction: PredictionBuffer | null = null;
  private inputController: ArenaInput | null = null;
  private latestSnapshot: MatchSnapshot | null = null;
  private localPresentation: PlayerPresentation | null = null;
  private inputSequence = 0;
  private cleaned = false;

  constructor(
    private readonly bridge: GamePresentationBridge,
    private readonly reducedMotion: boolean
  ) {
    super(ARENA_SCENE_KEY);
    this.localPlayerId = localPlayerIdFromBridge(bridge);
    this.prediction = this.localPlayerId ? new PredictionBuffer(this.localPlayerId) : null;
  }

  create(): void {
    this.drawArena();
    this.cleaned = false;
    this.inputController = new ArenaInput(createPhaserInputSource(this), {
      windowTarget: window,
      documentTarget: document,
      onShutdown: (listener) => {
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, listener);
        return () => this.events.off(Phaser.Scenes.Events.SHUTDOWN, listener);
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.releaseResources, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.releaseResources, this);

    const initial = this.bridge.getSnapshot();
    if (initial) this.acceptSnapshot(initial);
    this.unsubscribers.push(
      this.bridge.subscribeSnapshot((snapshot) => this.acceptSnapshot(snapshot)),
      this.bridge.subscribeEvent((event) => {
        this.canonicalEvents.push(event);
        if (this.canonicalEvents.length > 32) this.canonicalEvents.shift();
      }),
      this.bridge.subscribeMuted(() => undefined)
    );
  }

  update(): void {
    const snapshot = this.latestSnapshot;
    const localPlayer = snapshot && this.localPlayerId ? playerById(snapshot, this.localPlayerId) : null;
    if (snapshot && localPlayer && acceptsInput(snapshot) && this.inputController && this.prediction) {
      const frame = this.inputController.sample(this.inputSequence, localPlayer.position, performance.now());
      if (frame) {
        this.inputSequence += 1;
        this.localPresentation = this.prediction.predict(frame, localPlayer, INPUT_STEP_MS);
        this.bridge.sendInput(frame);
      }
    } else {
      this.inputController?.clearHeld();
    }
    this.renderPresentation(performance.now());
  }

  private acceptSnapshot(snapshot: MatchSnapshot): void {
    const receivedAtMs = performance.now();
    this.latestSnapshot = snapshot;
    this.timeline.push(snapshot, receivedAtMs);
    if (!this.localPlayerId || !this.prediction) return;
    const player = playerById(snapshot, this.localPlayerId);
    if (!player) {
      this.prediction.reset();
      this.localPresentation = null;
      return;
    }
    this.inputSequence = Math.max(this.inputSequence, player.lastProcessedInputSeq + 1);
    this.localPresentation = this.prediction.reconcile(player, INPUT_STEP_MS);
  }

  private renderPresentation(nowMs: number): void {
    const frame = this.timeline.sample(nowMs);
    if (!frame) return;
    const activeIds = new Set<string>();
    for (const currentPlayer of frame.current.players) {
      activeIds.add(currentPlayer.playerId);
      const isLocal = currentPlayer.playerId === this.localPlayerId;
      const view = this.views.get(currentPlayer.playerId) ?? this.addView(currentPlayer, isLocal);
      if (isLocal && this.localPresentation) {
        view.apply(
          currentPlayer,
          this.localPresentation.position,
          this.localPresentation.facing,
          this.localPresentation.actionStart
        );
        continue;
      }
      const previousPlayer = playerById(frame.previous, currentPlayer.playerId) ?? currentPlayer;
      const position = interpolateRemotePlayer(previousPlayer, currentPlayer, frame.alpha);
      view.apply(currentPlayer, position, currentPlayer.facing, null);
    }
    for (const [playerId, view] of this.views) {
      if (activeIds.has(playerId)) continue;
      view.destroy();
      this.views.delete(playerId);
    }
  }

  private addView(player: MatchPlayer, isLocal: boolean): FighterView {
    const view = createFighterView(this, player, isLocal);
    this.views.set(player.playerId, view);
    return view;
  }

  private drawArena(): void {
    this.cameras.main.setBackgroundColor('#02050a');
    const graphics = this.add.graphics();
    const regulationVertices = ARENA.regulationVertices.map((point) => new Phaser.Math.Vector2(point.x, point.y));
    const minimumVertices = ARENA.minimumVertices.map((point) => new Phaser.Math.Vector2(point.x, point.y));
    graphics.fillStyle(0x17202b, 1);
    graphics.fillPoints(regulationVertices, true);
    graphics.lineStyle(10, 0x394553, 1);
    graphics.strokePoints(regulationVertices, true, true);
    graphics.lineStyle(2, 0xff8a5b, this.reducedMotion ? 0.65 : 0.9);
    graphics.strokePoints(minimumVertices, true, true);
  }

  private releaseResources(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.inputController?.dispose();
    this.inputController = null;
    this.timeline.clear();
    this.canonicalEvents.length = 0;
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }
}
