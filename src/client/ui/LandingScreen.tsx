import { useState, type FormEvent } from 'react';
import type { ClientState } from '../state/gameStore.js';

type LandingScreenProps = Readonly<{
  state: ClientState;
  onCreateRoom: (name: string) => Promise<void>;
  onJoinRoom: (name: string, roomCode: string) => Promise<void>;
}>;

function ActionMark({ pending, idle }: Readonly<{ pending: boolean; idle: string }>) {
  return pending ? <span className="action-spinner" aria-hidden="true" /> : <span aria-hidden="true">{idle}</span>;
}

export function LandingScreen({ state, onCreateRoom, onJoinRoom }: LandingScreenProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const namePresent = Array.from(playerName.trim()).length >= 2;
  const roomCodePresent = roomCode.trim().length === 4;
  const anyPending = state.pendingAction !== null;
  const createPending = state.pendingAction === 'create-room';
  const joinPending = state.pendingAction === 'join-room';
  const inlineError =
    state.errorAction === 'create-room' || state.errorAction === 'join-room' || state.errorAction === 'resume'
      ? state.lastError
      : null;

  const submitCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!namePresent || anyPending) return;
    void onCreateRoom(playerName);
  };

  const submitJoin = (): void => {
    if (!namePresent || !roomCodePresent || anyPending) return;
    void onJoinRoom(playerName, roomCode);
  };

  return (
    <section className="screen screen--landing" aria-labelledby="landing-title">
      <div className="landing-frame tech-frame">
        <div className="landing-frame__energy" aria-hidden="true">
          <span />
        </div>

        <div className="landing-heading">
          <p className="eyebrow">LAN ARENA</p>
          <h1 id="landing-title">NEON RELAY</h1>
        </div>

        <form className="landing-form" onSubmit={submitCreate} noValidate>
          <label className="field field--cyan">
            <span>Oyuncu adı</span>
            <input
              className="focus-ring"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Adın"
              autoComplete="nickname"
              maxLength={32}
              aria-invalid={inlineError?.code === 'INVALID_NAME'}
              aria-describedby={inlineError ? 'landing-error' : undefined}
            />
          </label>

          <button
            className="command-button command-button--cyan focus-ring"
            type="submit"
            disabled={!namePresent || anyPending}
            aria-busy={createPending}
          >
            <span>Oda Kur</span>
            <ActionMark pending={createPending} idle="+" />
          </button>

          <div className="landing-divider" aria-hidden="true" />

          <label className="field field--amber">
            <span>Oda kodu</span>
            <input
              className="focus-ring room-code-input"
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.normalize('NFKC').trim().toUpperCase().slice(0, 4))}
              inputMode="text"
              autoComplete="off"
              maxLength={4}
              aria-invalid={inlineError?.code === 'INVALID_ROOM_CODE' || inlineError?.code === 'ROOM_NOT_FOUND'}
              aria-describedby={inlineError ? 'landing-error' : undefined}
            />
          </label>

          <button
            className="command-button command-button--amber focus-ring"
            type="button"
            disabled={!namePresent || !roomCodePresent || anyPending}
            aria-busy={joinPending}
            onClick={submitJoin}
          >
            <span>Odaya Katıl</span>
            <ActionMark pending={joinPending} idle="→" />
          </button>

          <div className="landing-feedback">
            {inlineError ? (
              <p className="inline-error" id="landing-error" role="alert">
                {inlineError.message}
              </p>
            ) : null}
          </div>
        </form>

        <p className="landing-tagline">Aynı ağdaki arkadaşlarınla oyna</p>
      </div>
    </section>
  );
}
