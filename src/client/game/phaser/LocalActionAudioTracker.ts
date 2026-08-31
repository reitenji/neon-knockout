import { GAME } from '../../../shared/constants.js';
import type { MatchAction } from '../../../shared/model.js';
import type { GameAudioCue } from './GameAudio.js';

type ActionKind = Exclude<MatchAction['kind'], null>;
type PendingPrediction = {
  key: string;
  kind: ActionKind;
  chargeMs: number;
  heavyReleased: boolean;
};

function isQuick(kind: MatchAction['kind']): kind is 'QUICK_1' | 'QUICK_2' | 'QUICK_3' {
  return kind === 'QUICK_1' || kind === 'QUICK_2' || kind === 'QUICK_3';
}

export class LocalActionAudioTracker {
  private nextPredictionSequence = 1;
  private pendingPrediction: PendingPrediction | null = null;
  private readonly presentedActionKeys = new Set<string>();

  private startCue(kind: ActionKind): GameAudioCue | null {
    if (isQuick(kind)) return 'quick';
    if (kind === 'DASH') return 'dash';
    if (kind === 'HEAVY') return 'heavy-charge';
    return null;
  }

  consume(action: MatchAction | null): readonly GameAudioCue[] {
    const cues: GameAudioCue[] = [];
    const kind = action?.kind ?? null;
    const attackId = action?.attackId ?? null;

    if (attackId !== null) {
      const key = `attack:${attackId}`;
      if (this.presentedActionKeys.has(key)) return cues;
      this.presentedActionKeys.add(key);

      const matchesPrediction = this.pendingPrediction?.kind === kind;
      if (!matchesPrediction && kind !== null) {
        const cue = kind === 'HEAVY' && !action?.charging ? 'heavy-release' : this.startCue(kind);
        if (cue) cues.push(cue);
      } else if (
        kind === 'HEAVY' &&
        !action?.charging &&
        this.pendingPrediction &&
        !this.pendingPrediction.heavyReleased
      ) {
        cues.push('heavy-release');
      }
      this.pendingPrediction = null;
      return cues;
    }

    if (kind === null) {
      if (
        this.pendingPrediction?.kind === 'HEAVY' &&
        this.pendingPrediction.chargeMs < GAME.heavyEnterChargeMs
      ) this.pendingPrediction = null;
      return cues;
    }

    if (!this.pendingPrediction || this.pendingPrediction.kind !== kind) {
      const sequence = this.nextPredictionSequence++;
      this.pendingPrediction = {
        key: `prediction:${sequence}`,
        kind,
        chargeMs: action?.chargeMs ?? 0,
        heavyReleased: false
      };
      if (!this.presentedActionKeys.has(this.pendingPrediction.key)) {
        this.presentedActionKeys.add(this.pendingPrediction.key);
        const cue = this.startCue(kind);
        if (cue) cues.push(cue);
      }
    }

    if (kind === 'HEAVY' && this.pendingPrediction) {
      this.pendingPrediction.chargeMs = Math.max(this.pendingPrediction.chargeMs, action?.chargeMs ?? 0);
      if (!action?.charging && !this.pendingPrediction.heavyReleased &&
        this.pendingPrediction.chargeMs >= GAME.heavyEnterChargeMs) {
        cues.push('heavy-release');
        this.pendingPrediction.heavyReleased = true;
      }
    }
    return cues;
  }

  reset(): void {
    this.nextPredictionSequence = 1;
    this.pendingPrediction = null;
    this.presentedActionKeys.clear();
  }
}
