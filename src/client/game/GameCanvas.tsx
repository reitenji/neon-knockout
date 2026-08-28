import { useEffect, useRef } from 'react';
import { ARENA, GAME } from '../../shared/constants.js';
import type { MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import type { GameStore } from '../state/gameStore.js';
import { KeyboardController } from './keyboard.js';
import { PredictionBuffer, SnapshotTimeline } from './prediction.js';
import { AuthoritativeParticles, fitArena, MAX_CANVAS_DPR, renderFrame, resizeCanvas } from './renderer.js';

type GameCanvasProps = Readonly<{
  store: GameStore;
  localPlayerId: string;
}>;

const INPUT_STEP_MS = 1_000 / GAME.tickRate;

function findLocalPlayer(snapshot: MatchSnapshot | null, playerId: string): MatchPlayer | null {
  if (!snapshot) return null;
  for (const player of snapshot.players) {
    if (player.playerId === playerId) return player;
  }
  return null;
}

function matchAcceptsInput(snapshot: MatchSnapshot | null): boolean {
  return snapshot?.phase === 'REGULATION' || snapshot?.phase === 'SUDDEN_DEATH';
}

function formatMatchClock(snapshot: MatchSnapshot | null): string {
  if (!snapshot) return '--:--';
  if (snapshot.phase === 'SUDDEN_DEATH') return '∞';
  const totalSeconds = Math.max(0, Math.ceil(snapshot.remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function phaseLabel(snapshot: MatchSnapshot | null): string {
  if (!snapshot) return '';
  if (snapshot.phase === 'COUNTDOWN') return String(Math.max(1, Math.ceil(snapshot.remainingMs / 1_000)));
  if (snapshot.phase === 'PAUSED') return 'Oyuncu yeniden bağlanıyor';
  if (snapshot.phase === 'SUDDEN_DEATH') return 'ALTIN ÇEKİRDEK';
  return '';
}

function setText(element: HTMLElement | null, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

export function GameCanvas({ store, localPlayerId }: GameCanvasProps) {
  const initialSnapshot = store.getLatestMatch() ?? store.getSnapshot().match;
  const initialPlayer = findLocalPlayer(initialSnapshot, localPlayerId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cyanScoreRef = useRef<HTMLElement>(null);
  const amberScoreRef = useRef<HTMLElement>(null);
  const clockRef = useRef<HTMLTimeElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const cooldownRef = useRef<HTMLDivElement>(null);
  const cooldownValueRef = useRef<HTMLSpanElement>(null);
  const carriedRef = useRef<HTMLSpanElement>(null);
  const pingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !stage || !context) return;

    const keyboard = new KeyboardController(window);
    const prediction = new PredictionBuffer(localPlayerId);
    const timeline = new SnapshotTimeline();
    const particles = new AuthoritativeParticles();
    const sentAtBySequence = new Map<number, number>();
    const floorImage = new Image();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let floorSource: CanvasImageSource | null = null;
    let latestSnapshot = store.getLatestMatch() ?? store.getSnapshot().match;
    let predictedPosition = findLocalPlayer(latestSnapshot, localPlayerId)?.position ?? null;
    let viewport = fitArena(ARENA.width, ARENA.height);
    let inputSequence = Math.max(0, (findLocalPlayer(latestSnapshot, localPlayerId)?.lastProcessedInputSeq ?? -1) + 1);
    let lastInputRttMs: number | null = null;
    let latestSnapshotReceivedAtMs = performance.now();
    let animationFrameId = 0;

    const updateHud = (snapshot: MatchSnapshot | null, nowMs: number): void => {
      const localPlayer = findLocalPlayer(snapshot, localPlayerId);
      setText(cyanScoreRef.current, String(snapshot?.score.CYAN ?? 0));
      setText(amberScoreRef.current, String(snapshot?.score.AMBER ?? 0));
      setText(clockRef.current, formatMatchClock(snapshot));
      setText(phaseRef.current, phaseLabel(snapshot));
      setText(carriedRef.current, localPlayer?.carriedCoreId ? 'TAŞIYOR' : '—');
      setText(pingRef.current, lastInputRttMs === null ? '— ms' : `${lastInputRttMs} ms`);

      const cooldownRemainingMs = Math.max(
        0,
        (localPlayer?.dashCooldownRemainingMs ?? 0) - (nowMs - latestSnapshotReceivedAtMs)
      );
      const progress = 1 - cooldownRemainingMs / GAME.dashCooldownMs;
      cooldownRef.current?.style.setProperty('--dash-progress', String(progress));
      cooldownRef.current?.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      setText(cooldownValueRef.current, cooldownRemainingMs > 0 ? `${(cooldownRemainingMs / 1_000).toFixed(1)}s` : 'Hazır');
    };

    const syncCanvasSize = (): void => {
      const bounds = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(stage.clientWidth || bounds.width || ARENA.width));
      const height = Math.max(1, Math.round(stage.clientHeight || bounds.height || ARENA.height));
      const dpr = Math.max(1, Math.min(MAX_CANVAS_DPR, window.devicePixelRatio || 1));
      resizeCanvas(canvas, width, height, dpr);
      context.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      viewport = fitArena(width, height);
    };

    const acceptSnapshot = (snapshot: MatchSnapshot): void => {
      const nowMs = performance.now();
      latestSnapshot = snapshot;
      latestSnapshotReceivedAtMs = nowMs;
      timeline.push(snapshot, nowMs);
      keyboard.setActive(matchAcceptsInput(snapshot));
      const localPlayer = findLocalPlayer(snapshot, localPlayerId);
      if (!localPlayer) {
        prediction.reset();
        predictedPosition = null;
        return;
      }

      inputSequence = Math.max(inputSequence, localPlayer.lastProcessedInputSeq + 1);
      predictedPosition = prediction.reconcile(localPlayer, INPUT_STEP_MS);
      const acknowledgedAt = sentAtBySequence.get(localPlayer.lastProcessedInputSeq);
      if (acknowledgedAt !== undefined) lastInputRttMs = Math.max(0, Math.round(nowMs - acknowledgedAt));
      for (const sequence of sentAtBySequence.keys()) {
        if (sequence > localPlayer.lastProcessedInputSeq) break;
        sentAtBySequence.delete(sequence);
      }
    };

    if (latestSnapshot) {
      timeline.push(latestSnapshot, performance.now());
      prediction.reset(findLocalPlayer(latestSnapshot, localPlayerId) ?? undefined);
      keyboard.setActive(matchAcceptsInput(latestSnapshot));
    }

    const unsubscribeMatch = store.subscribeMatch(acceptSnapshot);
    const unsubscribeEvents = store.subscribeGameEvent((event) => {
      if (latestSnapshot) particles.ingest(event, latestSnapshot, performance.now());
    });

    const resizeObserver = new ResizeObserver(syncCanvasSize);
    resizeObserver.observe(stage);
    syncCanvasSize();

    floorImage.onload = () => {
      floorSource = floorImage;
    };
    floorImage.src = '/assets/arena-floor.png';

    const inputIntervalId = window.setInterval(() => {
      const snapshot = latestSnapshot;
      const inputActive = store.getSnapshot().connectionState === 'connected' && matchAcceptsInput(snapshot);
      keyboard.setActive(inputActive);
      if (!inputActive) return;
      const localPlayer = findLocalPlayer(snapshot, localPlayerId);
      if (!localPlayer) return;
      const frame = keyboard.sample(inputSequence);
      inputSequence += 1;
      const nowMs = performance.now();
      predictedPosition = prediction.predict(frame, localPlayer, INPUT_STEP_MS);
      sentAtBySequence.set(frame.seq, nowMs);
      if (sentAtBySequence.size > 120) {
        const oldestSequence = sentAtBySequence.keys().next().value as number | undefined;
        if (oldestSequence !== undefined) sentAtBySequence.delete(oldestSequence);
      }
      store.sendInput(frame);
    }, INPUT_STEP_MS);

    const render = (nowMs: number): void => {
      const frame = timeline.sample(nowMs);
      if (frame) {
        renderFrame(context, {
          viewport,
          snapshot: frame.current,
          previousSnapshot: frame.previous,
          interpolationAlpha: frame.alpha,
          localPlayerId,
          predictedLocalPosition: predictedPosition,
          floorImage: floorSource,
          particles,
          nowMs,
          reducedMotion
        });
      }
      updateHud(latestSnapshot, nowMs);
      animationFrameId = requestAnimationFrame(render);
    };

    updateHud(latestSnapshot, performance.now());
    animationFrameId = requestAnimationFrame(render);

    return () => {
      floorImage.onload = null;
      unsubscribeEvents();
      unsubscribeMatch();
      resizeObserver.disconnect();
      window.clearInterval(inputIntervalId);
      cancelAnimationFrame(animationFrameId);
      keyboard.destroy();
    };
  }, [localPlayerId, store]);

  return (
    <section className="screen game-screen" aria-label="ÇEKİRDEK">
      <header className="game-scoreboard" aria-label="Skor">
        <div className="game-score game-score--cyan">
          <span>CAMGÖBEĞİ</span>
          <strong ref={cyanScoreRef}>{initialSnapshot?.score.CYAN ?? 0}</strong>
        </div>
        <div className="game-clock">
          <time ref={clockRef} aria-label="Kalan süre">
            {formatMatchClock(initialSnapshot)}
          </time>
          <span ref={phaseRef} className="game-clock__phase" aria-live="polite">
            {phaseLabel(initialSnapshot)}
          </span>
        </div>
        <div className="game-score game-score--amber">
          <span>KEHRİBAR</span>
          <strong ref={amberScoreRef}>{initialSnapshot?.score.AMBER ?? 0}</strong>
        </div>
      </header>

      <div ref={stageRef} className="game-stage tech-frame">
        <canvas ref={canvasRef} className="game-canvas" role="img" aria-label="Neon Relay oyun alanı" />
      </div>

      <footer className="game-command-rail">
        <div className="hud-module hud-module--dash">
          <span>HAMLE</span>
          <div
            ref={cooldownRef}
            className="dash-meter"
            role="progressbar"
            aria-label="Hamle hazır olma"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={100}
          >
            <i aria-hidden="true" />
          </div>
          <strong ref={cooldownValueRef}>Hazır</strong>
        </div>

        <div className="hud-module hud-module--core">
          <span>ÇEKİRDEK</span>
          <strong ref={carriedRef}>{initialPlayer?.carriedCoreId ? 'TAŞIYOR' : '—'}</strong>
        </div>

        <div className="hud-module hud-module--ping" aria-label="Ping">
          <span ref={pingRef}>— ms</span>
        </div>

        <div className="hud-controls" aria-label="Kontroller">
          <span>WASD: Hareket</span>
          <span>SPACE: Hamle</span>
        </div>
      </footer>
    </section>
  );
}
