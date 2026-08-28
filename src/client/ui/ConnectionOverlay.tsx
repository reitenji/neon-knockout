import type { GameClientConnectionState } from '../network/GameClient.js';

type ConnectionOverlayProps = Readonly<{
  connectionState: GameClientConnectionState;
  remainingMs: number | null;
  onRetry: () => void;
}>;

export function ConnectionOverlay({ connectionState, remainingMs, onRetry }: ConnectionOverlayProps) {
  const seconds = Math.max(0, Math.ceil((remainingMs ?? 0) / 1_000));
  const waitingForOpponent = connectionState === 'connected';
  const disconnected = connectionState === 'disconnected';
  const title = waitingForOpponent ? 'Rakip bekleniyor' : 'Bağlantı kesildi';
  return (
    <section className="connection-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="connection-overlay__panel tech-frame">
        <h2>{title}</h2>
        <p>{remainingMs === null ? 'Oturum yeniden bağlanıyor.' : `${waitingForOpponent ? 'Rakibin yeri' : 'Oturumun'} ${seconds} saniye daha korunuyor.`}</p>
        <p role="status">{waitingForOpponent ? 'Maç rakibin dönüşüne kadar duraklatıldı.' : disconnected ? 'Sunucuya ulaşılamıyor.' : 'Yeniden bağlanılıyor…'}</p>
        {disconnected ? <button className="command-button focus-ring" type="button" onClick={onRetry}>Yeniden Dene</button> : null}
      </div>
    </section>
  );
}
