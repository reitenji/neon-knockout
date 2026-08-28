import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../shared/model.js';
import {
  GameAudio, detuneForEvent, type AudioPlayOptions, type GameAudioAdapter, type GameAudioCue
} from './GameAudio.js';

type PlayedCue = Readonly<{ cue: GameAudioCue; options: AudioPlayOptions }>;

class RecordingAudioAdapter implements GameAudioAdapter {
  readonly played: PlayedCue[] = [];
  gestureListener: (() => void) | null = null;
  unlocks = 0;
  stops = 0;
  destroys = 0;
  removedGestures = 0;

  onFirstGesture(listener: () => void): () => void {
    this.gestureListener = listener;
    return () => {
      this.removedGestures += 1;
      this.gestureListener = null;
    };
  }
  unlock(): void { this.unlocks += 1; }
  play(cue: GameAudioCue, options: AudioPlayOptions): void { this.played.push({ cue, options }); }
  stopAll(): void { this.stops += 1; }
  destroy(): void { this.destroys += 1; }

  gesture(): void { this.gestureListener?.(); }
}

function hit(eventId = 42, attack: 'QUICK_1' | 'HEAVY' = 'QUICK_1'): GameEvent {
  return {
    eventId, tick: 9, type: 'HIT', attackerId: 'a', targetId: 'b', attack,
    impactPosition: { x: 20, y: 30 }, impulse: 380, resultingOverload: 60
  };
}

describe('GameAudio', () => {
  it('waits for one user gesture, then layers deterministic attack and contact cues once per event ID', () => {
    const adapter = new RecordingAudioAdapter();
    const audio = new GameAudio(adapter);

    expect(audio.playEvent(hit())).toBe(true);
    expect(adapter.played).toEqual([]);

    adapter.gesture();
    adapter.gesture();
    expect(adapter.unlocks).toBe(1);
    expect(adapter.removedGestures).toBe(1);

    expect(audio.playEvent(hit(43))).toBe(true);
    expect(audio.playEvent(hit(43))).toBe(false);
    expect(adapter.played).toEqual([
      { cue: 'quick', options: { volume: 0.56, detune: detuneForEvent(43, 0) } },
      { cue: 'hit', options: { volume: 0.72, detune: detuneForEvent(43, 1) } }
    ]);
  });

  it('uses the heavy release layer for confirmed heavy hits', () => {
    const adapter = new RecordingAudioAdapter();
    const audio = new GameAudio(adapter);
    adapter.gesture();

    audio.playEvent(hit(12, 'HEAVY'));

    expect(adapter.played.map(({ cue }) => cue)).toEqual(['heavy-release', 'hit']);
  });

  it('stops every active sound immediately on mute and stays silent until unmuted', () => {
    const adapter = new RecordingAudioAdapter();
    const audio = new GameAudio(adapter);
    adapter.gesture();
    audio.playCue('dash', 5);

    audio.setMuted(true);
    audio.playEvent({
      eventId: 6, tick: 10, type: 'KNOCKOUT', attackerId: 'a', targetId: 'b',
      scoreAwardedTo: 'a', scores: { a: 1, b: 0 }
    });
    expect(adapter.stops).toBe(1);
    expect(adapter.played.map(({ cue }) => cue)).toEqual(['dash']);

    audio.setMuted(false);
    audio.playEvent({ eventId: 7, tick: 11, type: 'RESPAWN', playerId: 'b', position: { x: 10, y: 10 } });
    expect(adapter.played.at(-1)?.cue).toBe('respawn');
  });

  it('maps match phases and results to their dedicated cues', () => {
    const adapter = new RecordingAudioAdapter();
    const audio = new GameAudio(adapter);
    adapter.gesture();

    const events: GameEvent[] = [
      { eventId: 1, tick: 1, type: 'PHASE', phase: 'COUNTDOWN', remainingMs: 3_000 },
      { eventId: 2, tick: 2, type: 'PHASE', phase: 'SUDDEN_DEATH', remainingMs: 0 },
      { eventId: 3, tick: 3, type: 'RESULT', winnerPlayerId: 'a', reason: 'TARGET_SCORE', scores: { a: 5 } }
    ];
    for (const event of events) audio.playEvent(event);

    expect(adapter.played.map(({ cue }) => cue)).toEqual(['countdown', 'warning', 'victory']);
  });

  it('removes the gesture listener, stops sound, and destroys owned sounds once on teardown', () => {
    const adapter = new RecordingAudioAdapter();
    const audio = new GameAudio(adapter);

    audio.dispose();
    audio.dispose();

    expect(adapter.removedGestures).toBe(1);
    expect(adapter.stops).toBe(1);
    expect(adapter.destroys).toBe(1);
    adapter.gesture();
    expect(adapter.unlocks).toBe(0);
    expect(audio.playCue('quick', 99)).toBe(false);
  });
});
