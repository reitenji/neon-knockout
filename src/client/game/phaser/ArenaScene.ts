import Phaser from 'phaser';
import { GAME } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer, MatchSnapshot, Vec2 } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { localPlayerIdFromBridge } from '../GamePresentationBridge.js';
import { SnapshotTimeline, interpolateRemotePlayer } from '../prediction.js';
import { ARENA_SCENE_KEY } from './BootScene.js';
import { ArenaInput, createPhaserInputSource } from './ArenaInput.js';
import { combineArenaInputSources } from './TouchInputSource.js';
import { ArenaSession } from './ArenaSession.js';
import { createArenaView, type ArenaView } from './ArenaView.js';
import {
  createFighterView,
  type ChargeIndicatorState,
  type FighterView
} from './FighterView.js';
import { GameAudio } from './GameAudio.js';
import { ImpactFx } from './ImpactFx.js';
import { LocalActionAudioTracker } from './LocalActionAudioTracker.js';
import { PhaserAudioAdapter } from './PhaserAudioAdapter.js';
import { PhaserImpactAdapter } from './PhaserImpactAdapter.js';
import { createPulseView, type PulseView } from './PulseView.js';
import { AttackTelegraphTracker } from './attackTelegraphTracker.js';

const INPUT_STEP_MS = 1_000 / 60;

function playerById(snapshot: MatchSnapshot, playerId: string): MatchPlayer | null {
  return snapshot.players.find((player) => player.playerId === playerId) ?? null;
}

function chargeIndicator(
  player: MatchPlayer,
  presentationFacing: Vec2,
  predictedAction: MatchAction | null
): ChargeIndicatorState | null {
  const predictedCharge = predictedAction && predictedAction.chargeMs > 0 &&
    (predictedAction.kind === null || predictedAction.kind === 'HEAVY')
    ? predictedAction
    : null;
  const action = predictedCharge ?? player.action;
  if (action.chargeMs <= 0 || (action.kind !== null && action.kind !== 'HEAVY')) return null;
  const releasedFacing = action.kind === 'HEAVY' && !action.charging ? action.lockedFacing : null;
  return {
    facing: releasedFacing ?? presentationFacing,
    progress: Math.max(0, Math.min(1, action.chargeMs / GAME.heavyMaxChargeMs)),
    pulseReady: action.chargeMs >= GAME.heavyMaxChargeMs
  };
}

export class ArenaScene extends Phaser.Scene {
  private readonly localPlayerId: string | null;
  private readonly timeline = new SnapshotTimeline();
  private readonly views = new Map<string, FighterView>();
  private readonly pulseViews = new Map<number, PulseView>();
  private readonly activePlayerIds = new Set<string>();
  private readonly activePulseIds = new Set<number>();
  private readonly retiredPulseIds = new Set<number>();
  private readonly consumedEventIds = new Set<number>();
  private readonly localActionAudio = new LocalActionAudioTracker();
  private readonly attackTelegraphs = new AttackTelegraphTracker();
  private readonly unsubscribers: Array<() => void> = [];
  private session: ArenaSession | null = null;
  private arenaView: ArenaView | null = null;
  private impactFx: ImpactFx | null = null;
  private gameAudio: GameAudio | null = null;
  private localCueSequence = 0;
  private resultPresented = false;
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
    this.clearPulseViews();
    this.activePlayerIds.clear();
    this.activePulseIds.clear();
    this.retiredPulseIds.clear();
    this.resultPresented = false;
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
    const keyboardInput = createPhaserInputSource(this);
    const inputSource = this.bridge.inputSource
      ? combineArenaInputSources(keyboardInput, this.bridge.inputSource)
      : keyboardInput;
    const inputController = new ArenaInput(inputSource, {
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
        if (event.type === 'PULSE_BREAK') {
          this.retiredPulseIds.add(event.projectileId);
          this.destroyPulseView(event.projectileId);
        }
        if (event.type === 'PERFECT_DODGE' && event.projectileId !== null) {
          this.retiredPulseIds.add(event.projectileId);
          this.destroyPulseView(event.projectileId);
        }
        if (event.type === 'RESULT') {
          this.resultPresented = true;
          this.clearPulseViews();
        }
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
    this.bridge.publishPresentationDelay?.(this.timeline.delayMs());
    this.arenaView?.apply({
      phase: frame.current.phase,
      remainingMs: frame.current.remainingMs,
      platformProgress: frame.current.platformProgress,
      settings: frame.current.settings
    }, nowMs);
    const localPresentation = this.session?.getLocalPresentation() ?? null;
    this.reconcilePulses(frame.current);
    const activeIds = this.activePlayerIds;
    activeIds.clear();
    for (const currentPlayer of frame.current.players) {
      activeIds.add(currentPlayer.playerId);
      const isLocal = currentPlayer.playerId === this.localPlayerId;
      const view = this.views.get(currentPlayer.playerId) ?? this.addView(currentPlayer, isLocal);
      const previousPlayer = playerById(frame.previous, currentPlayer.playerId) ?? currentPlayer;
      if (isLocal && localPresentation) {
        const telegraph = this.attackTelegraphs.telegraph(
          currentPlayer.playerId,
          previousPlayer,
          currentPlayer,
          localPresentation.actionStart,
          localPresentation.facing,
          nowMs,
          true
        );
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
          localPresentation.actionStart,
          telegraph,
          chargeIndicator(currentPlayer, localPresentation.facing, localPresentation.actionStart)
        );
        continue;
      }
      const telegraph = this.attackTelegraphs.telegraph(
        currentPlayer.playerId,
        previousPlayer,
        currentPlayer,
        null,
        currentPlayer.facing,
        nowMs,
        false
      );
      const position = interpolateRemotePlayer(previousPlayer, currentPlayer, frame.alpha);
      view.apply(
        currentPlayer,
        position,
        currentPlayer.facing,
        null,
        telegraph,
        chargeIndicator(currentPlayer, currentPlayer.facing, null)
      );
    }
    for (const [playerId, view] of this.views) {
      if (activeIds.has(playerId)) continue;
      view.destroy();
      this.views.delete(playerId);
    }
    this.attackTelegraphs.prune(activeIds);
  }

  private addView(player: MatchPlayer, isLocal: boolean): FighterView {
    const view = createFighterView(this, player, isLocal, { reducedMotion: this.reducedMotion });
    this.views.set(player.playerId, view);
    return view;
  }

  private reconcilePulses(snapshot: MatchSnapshot): void {
    const activeIds = this.activePulseIds;
    activeIds.clear();
    if (this.resultPresented || snapshot.phase === 'FINISHED' || snapshot.winnerPlayerId !== null) {
      this.clearPulseViews();
      return;
    }
    for (const pulse of snapshot.pulses) {
      if (this.retiredPulseIds.has(pulse.projectileId)) continue;
      activeIds.add(pulse.projectileId);
      const existing = this.pulseViews.get(pulse.projectileId);
      if (existing) existing.apply(pulse);
      else this.pulseViews.set(pulse.projectileId, createPulseView(this, pulse));
    }
    for (const projectileId of this.pulseViews.keys()) {
      if (!activeIds.has(projectileId)) this.destroyPulseView(projectileId);
    }
  }

  private destroyPulseView(projectileId: number): void {
    const view = this.pulseViews.get(projectileId);
    if (!view) return;
    view.destroy();
    this.pulseViews.delete(projectileId);
  }

  private clearPulseViews(): void {
    for (const view of this.pulseViews.values()) view.destroy();
    this.pulseViews.clear();
  }

  private releaseResources(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.session?.dispose();
    this.session = null;
    this.timeline.clear();
    this.attackTelegraphs.reset();
    this.activePlayerIds.clear();
    this.activePulseIds.clear();
    this.consumedEventIds.clear();
    this.retiredPulseIds.clear();
    this.resultPresented = false;
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
    this.clearPulseViews();
  }
}
