import type { ClientState } from '../state/gameStore.js';

type TopBarProps = Readonly<{
  state: ClientState;
  onToggleSound: () => void;
}>;

export function TopBar({ state, onToggleSound }: TopBarProps) {
  const connected = state.connectionState === 'connected';

  return (
    <header className="top-bar">
      <span className="top-bar__mark">NEON <strong>KNOCKOUT</strong></span>

      <span className="top-bar__context">
        {state.room ? (
          <>
            <span>ODA</span>
            <strong>{state.room.roomCode}</strong>
          </>
        ) : (
          'LAN ARENA'
        )}
      </span>

      <span className="top-bar__controls">
        <span className={`connection-state ${connected ? 'is-connected' : 'is-connecting'}`} role="status">
          <span className="status-light" aria-hidden="true" />
          {connected ? 'Bağlı' : 'Bağlantı kuruluyor'}
        </span>
        <button
          className="sound-button focus-ring"
          type="button"
          aria-pressed={!state.soundMuted}
          onClick={onToggleSound}
        >
          <span aria-hidden="true">{state.soundMuted ? '◖' : '◕'}</span>
          {state.soundMuted ? 'Ses kapalı' : 'Ses açık'}
        </button>
      </span>
    </header>
  );
}
