import { GAME } from '../../../shared/constants.js';
import type { MatchAction } from '../../../shared/model.js';
import type { GameAudioCue } from './GameAudio.js';

type ActionKind = Exclude<MatchAction['kind'], null>;

function isQuick(kind: MatchAction['kind']): kind is 'QUICK_1' | 'QUICK_2' | 'QUICK_3' {
  return kind === 'QUICK_1' || kind === 'QUICK_2' || kind === 'QUICK_3';
}

export class LocalActionAudioTracker {
  private previousKind: ActionKind | null = null;
  private previousHeavyChargeMs = 0;

  consume(action: MatchAction | null): readonly GameAudioCue[] {
    const cues: GameAudioCue[] = [];
    const kind = action?.kind ?? null;

    if (isQuick(kind) && kind !== this.previousKind) {
      cues.push('quick');
    } else if (kind === 'DASH' && this.previousKind !== 'DASH') {
      cues.push('dash');
    } else if (kind === 'HEAVY' && this.previousKind !== 'HEAVY') {
      cues.push('heavy-charge');
    } else if (
      kind === null &&
      this.previousKind === 'HEAVY' &&
      this.previousHeavyChargeMs >= GAME.heavyEnterChargeMs
    ) {
      cues.push('heavy-release');
    }

    this.previousKind = kind;
    this.previousHeavyChargeMs = action?.kind === 'HEAVY' ? action.chargeMs : 0;
    return cues;
  }

  reset(): void {
    this.previousKind = null;
    this.previousHeavyChargeMs = 0;
  }
}
