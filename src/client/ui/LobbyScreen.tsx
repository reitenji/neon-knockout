import type { RoomPlayer, Team } from '../../shared/model.js';
import { selectCanStart, selectSelfPlayer, type ClientState } from '../state/gameStore.js';

type LobbyScreenProps = Readonly<{
  state: ClientState;
  onSetTeam: (team: Team) => Promise<void>;
  onToggleReady: (ready: boolean) => Promise<void>;
  onStart: () => Promise<void>;
  onCopyRoomCode: () => Promise<void>;
}>;

function teamLabel(team: Team): string {
  return team === 'CYAN' ? 'Camgöbeği Takım' : 'Kehribar Takım';
}

function ActionMark({ pending, idle }: Readonly<{ pending: boolean; idle: string }>) {
  return pending ? <span className="action-spinner" aria-hidden="true" /> : <span aria-hidden="true">{idle}</span>;
}

function PlayerRow({ player, hostPlayerId }: Readonly<{ player: RoomPlayer; hostPlayerId: string }>) {
  const status = player.connected ? (player.ready ? 'Hazır' : 'Bekliyor') : 'Bağlantı bekleniyor';
  const statusClass = !player.connected ? 'is-disconnected' : player.ready ? 'is-ready' : 'is-waiting';

  return (
    <li className={`player-row ${statusClass}`}>
      <span className="player-row__identity">
        <span className="team-dot" aria-hidden="true" />
        <strong>{player.name}</strong>
        {player.playerId === hostPlayerId ? (
          <span className="host-crown" role="img" aria-label="Oda sahibi">
            ♛
          </span>
        ) : null}
      </span>
      <span className="player-row__status">
        <span className="status-light" aria-hidden="true" />
        {status}
      </span>
    </li>
  );
}

export function LobbyScreen({ state, onSetTeam, onToggleReady, onStart, onCopyRoomCode }: LobbyScreenProps) {
  if (!state.room) return null;
  const { room } = state;
  const selfPlayer = selectSelfPlayer(state);
  const isHost = selfPlayer?.playerId === room.hostPlayerId;
  const anyPending = state.pendingAction !== null;
  const readyPending = state.pendingAction === 'ready';
  const startPending = state.pendingAction === 'start';
  const lobbyError =
    state.errorAction === 'team' || state.errorAction === 'ready' || state.errorAction === 'start'
      ? state.lastError
      : null;

  return (
    <section className="screen screen--lobby" aria-label="ODA">
      <div className="lobby-frame tech-frame">
        <header className="lobby-room">
          <span className="eyebrow">ODA</span>
          <strong className="room-code" data-testid="room-code">
            {room.roomCode}
          </strong>
          <button
            className="chrome-button copy-button focus-ring"
            type="button"
            aria-label="Kodu Kopyala"
            onClick={() => void onCopyRoomCode()}
          >
            <span>Kodu Kopyala</span>
            <span className={`copy-button__mark is-${state.copyFeedback}`} aria-hidden="true">
              {state.copyFeedback === 'copied' ? '✓' : state.copyFeedback === 'failed' ? '!' : '⧉'}
            </span>
          </button>
        </header>

        <div className="team-grid">
          {(['CYAN', 'AMBER'] as const).map((team) => {
            const selected = selfPlayer?.team === team;
            return (
              <section key={team} className={`team-panel team-panel--${team.toLowerCase()}`}>
                <header className="team-panel__header">
                  <h2>{teamLabel(team)}</h2>
                  {selfPlayer ? (
                    <button
                      className="team-switch focus-ring"
                      type="button"
                      aria-label={teamLabel(team)}
                      aria-pressed={selected}
                      disabled={selected || anyPending}
                      onClick={() => void onSetTeam(team)}
                    >
                      {state.pendingAction === 'team' && !selected ? (
                        <span className="action-spinner" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">{selected ? '✓' : '⇄'}</span>
                      )}
                    </button>
                  ) : null}
                </header>

                <ul className="player-list">
                  {room.players
                    .filter((player) => player.team === team)
                    .map((player) => (
                      <PlayerRow key={player.playerId} player={player} hostPlayerId={room.hostPlayerId} />
                    ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="lobby-feedback">
          {lobbyError ? (
            <p className="inline-error" role="alert">
              {lobbyError.message}
            </p>
          ) : null}
        </div>

        <footer className="lobby-actions">
          {selfPlayer ? (
            <button
              className="command-button command-button--cyan focus-ring"
              type="button"
              disabled={anyPending}
              aria-busy={readyPending}
              onClick={() => void onToggleReady(!selfPlayer.ready)}
            >
              <span>{selfPlayer.ready ? 'Hazır Değilim' : 'Hazırım'}</span>
              <ActionMark pending={readyPending} idle={selfPlayer.ready ? '×' : '✓'} />
            </button>
          ) : null}

          {isHost ? (
            <button
              className="command-button command-button--amber focus-ring"
              type="button"
              disabled={!selectCanStart(state) || anyPending}
              aria-busy={startPending}
              onClick={() => void onStart()}
            >
              <span>Maçı Başlat</span>
              <ActionMark pending={startPending} idle="→" />
            </button>
          ) : null}
        </footer>
      </div>
    </section>
  );
}
