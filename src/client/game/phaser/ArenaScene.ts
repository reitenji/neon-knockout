import Phaser from 'phaser';
import type { MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { localPlayerIdFromBridge } from '../GamePresentationBridge.js';
import { SnapshotTimeline, interpolateRemotePlayer } from '../prediction.js';
import { ARENA_SCENE_KEY } from './BootScene.js';
import { ArenaInput, createPhaserInputSource } from './ArenaInput.js';
import { ArenaSession } from './ArenaSession.js';
import { createArenaView, type ArenaView } from './ArenaView.js';
import { createFighterView, type FighterView } from './FighterView.js';
import { GameAudio } from './GameAudio.js';
import { ImpactFx } from './ImpactFx.js';
import { LocalActionAudioTracker } from './LocalActionAudioTracker.js';
import { PhaserAudioAdapter } from './PhaserAudioAdapter.js';
import { PhaserImpactAdapter } from './PhaserImpactAdapter.js';

const INPUT_STEP_MS = 1_000 / 60;

function playerById(snapshot: MatchSnapshot, playerId: string): MatchPlayer | null {
  return snapshot.players.find((player) => player.playerId === playerId) ?? null;
}

export class ArenaScene extends Phaser.Scene {
  private readonly localPlayerId: string | null;
  private readonly timeline = new SnapshotTimeline();
  private readonly views = new Map<string, FighterView>();
  private readonly consumedEventIds = new Set<number>();
  private readonly localActionAudio = new LocalActionAudioTracker();
  private readonly unsubscribers: Array<() => void> = [];
  private session: ArenaSession | null = null;
  private arenaView: ArenaView | null = null;
  private impactFx: ImpactFx | null = null;
  private gameAudio: GameAudio | null = null;
  private localCueSequence = 0;
  private cleaned = false;

  constructor(
    private readonly bridge: GamePresentationBridge,
    private readonly reducedMotion: boolean
  ) {
    super(ARENA_SCENE_KEY);
    this.localPlayerId = localPlayerIdFromBridge(bridge);
  }

  create(): void {
    this.cleaned = false;
    this.consumedEventIds.clear();
    this.localActionAudio.reset();
    this.localCueSequence = 0;
    this.cameras.main.setBackgroundColor('#02050a');
    this.arenaView = createArenaView(this, { reducedMotion: this.reducedMotion });
    this.impactFx = new ImpactFx(
      new PhaserImpactAdapter(this, (playerId) => this.views.get(playerId) ?? null),
      { reducedMotion: this.reducedMotion }
    );
    this.gameAudio = new GameAudio(new PhaserAudioAdapter(this.sound, window));
    const inputController = new ArenaInput(createPhaserInputSource(this), {
      windowTarget: window,
      documentTarget: document,
      onShutdown: (listener) => {
        this.events.on(Phaser.Scenes.Events.SHUTDOWN, listener);
        return () => this.events.off(Phaser.Scenes.Events.SHUTDOWN, listener);
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.releaseResources, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.releaseResources, this);

    this.session = new ArenaSession(
      this.bridge,
      this.localPlayerId ?? '',
      inputController,
      () => performance.now(),
      (snapshot, receivedAtMs) => this.timeline.push(snapshot, receivedAtMs)
    );
    this.session.start();
    this.unsubscribers.push(
      this.bridge.subscribeEvent((event) => {
        if (this.consumedEventIds.has(event.eventId)) return;
        this.consumedEventIds.add(event.eventId);
        const snapshot = this.bridge.getSnapshot();
        if (snapshot) this.impactFx?.ingest(event, snapshot);
        this.gameAudio?.playEvent(event);
      }),
      this.bridge.subscribeMuted((muted) => this.gameAudio?.setMuted(muted))
    );
  }

  update(): void {
    this.session?.step(INPUT_STEP_MS);
    this.renderPresentation(performance.now());
  }

  private renderPresentation(nowMs: number): void {
    const frame = this.timeline.sample(nowMs);
    if (!frame) return;
    this.arenaView?.apply({
      phase: frame.current.phase,
      remainingMs: frame.current.remainingMs,
      platformProgress: frame.current.platformProgress
    }, nowMs);
    const localPresentation = this.session?.getLocalPresentation() ?? null;
    const activeIds = new Set<string>();
    for (const currentPlayer of frame.current.players) {
      activeIds.add(currentPlayer.playerId);
      const isLocal = currentPlayer.playerId === this.localPlayerId;
      const view = this.views.get(currentPlayer.playerId) ?? this.addView(currentPlayer, isLocal);
      if (isLocal && localPresentation) {
        const canPresentLocalAction = (frame.current.phase === 'REGULATION' || frame.current.phase === 'SUDDEN_DEATH') &&
          currentPlayer.hitstunRemainingMs <= 0 && currentPlayer.respawnRemainingMs <= 0;
        if (canPresentLocalAction) {
          for (const cue of this.localActionAudio.consume(localPresentation.actionStart)) {
            this.gameAudio?.playCue(cue, ++this.localCueSequence);
          }
        } else {
          this.localActionAudio.reset();
        }
        view.apply(
          currentPlayer,
          localPresentation.position,
          localPresentation.facing,
          localPresentation.actionStart
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
    const view = createFighterView(this, player, isLocal, { reducedMotion: this.reducedMotion });
    this.views.set(player.playerId, view);
    return view;
  }

  private releaseResources(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.session?.dispose();
    this.session = null;
    this.timeline.clear();
    this.consumedEventIds.clear();
    this.localActionAudio.reset();
    this.localCueSequence = 0;
    this.impactFx?.dispose();
    this.impactFx = null;
    this.gameAudio?.dispose();
    this.gameAudio = null;
    this.arenaView?.destroy();
    this.arenaView = null;
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }
}
