import { useEffect, useRef, useState } from 'react';
import type { RuntimeNetworkInfo } from '../../shared/runtime.js';
import { buildRoomInviteUrl } from '../inviteRoute.js';
import '../styles/lan-share.css';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ClipboardLike = Readonly<{ writeText: (value: string) => Promise<void> }>;

export type LanSharePanelProps = Readonly<{
  roomCode: string;
  fetchImpl?: FetchLike;
  clipboard?: ClipboardLike;
}>;

type NetworkState = Readonly<{
  status: 'loading' | 'ready' | 'error';
  info: RuntimeNetworkInfo | null;
}>;

type CopyFeedback = Readonly<{
  status: 'copied' | 'failed';
  url: string;
}> | null;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function isRuntimeNetworkInfo(value: unknown): value is RuntimeNetworkInfo {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.port !== 'number' || typeof candidate.localUrl !== 'string' || !Array.isArray(candidate.lanAddresses)) {
    return false;
  }
  return candidate.lanAddresses.every((address) => {
    if (typeof address !== 'object' || address === null) return false;
    const fields = address as Record<string, unknown>;
    return typeof fields.interfaceName === 'string' && typeof fields.address === 'string' && typeof fields.url === 'string';
  });
}

async function defaultCopy(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Plain HTTP LAN origins may not expose the secure Clipboard API.
    }
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('COPY_FAILED');
}

async function readNetworkInfo(fetchImpl: FetchLike): Promise<RuntimeNetworkInfo> {
  const response = await fetchImpl('/api/runtime/network', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('NETWORK_INFO_REQUEST_FAILED');
  const body: unknown = await response.json();
  if (!isRuntimeNetworkInfo(body)) throw new Error('INVALID_NETWORK_INFO');
  return body;
}

function copyFeedbackMessage(feedback: Exclude<CopyFeedback, null>): string {
  return `${feedback.url} ${feedback.status === 'copied' ? 'kopyalandı.' : 'kopyalanamadı.'}`;
}

export function LanSharePanel({ roomCode, fetchImpl = defaultFetch, clipboard }: LanSharePanelProps) {
  const [network, setNetwork] = useState<NetworkState>({ status: 'loading', info: null });
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    void readNetworkInfo(fetchImpl).then((body) => {
      if (generation === requestGeneration.current) {
        setNetwork({ status: 'ready', info: body });
        setCopyFeedback(null);
      }
    }, () => {
      if (generation === requestGeneration.current) setNetwork({ status: 'error', info: null });
    });
    return () => { requestGeneration.current += 1; };
  }, [fetchImpl]);

  const refreshNetworkInfo = (): void => {
    setNetwork((current) => ({ status: 'loading', info: current.info }));
    const generation = ++requestGeneration.current;
    void readNetworkInfo(fetchImpl).then((body) => {
      if (generation === requestGeneration.current) {
        setNetwork({ status: 'ready', info: body });
        setCopyFeedback(null);
      }
    }, () => {
      if (generation === requestGeneration.current) setNetwork({ status: 'error', info: null });
    });
  };

  const lanAddresses = network.info?.lanAddresses ?? [];
  const copyLink = async (url: string): Promise<void> => {
    try {
      await (clipboard?.writeText(url) ?? defaultCopy(url));
      setCopyFeedback({ status: 'copied', url });
    } catch {
      setCopyFeedback({ status: 'failed', url });
    }
  };

  return (
    <aside className="lan-share-panel" aria-label="LAN bağlantısı" aria-busy={network.status === 'loading'}>
      <span className="lan-share-panel__label">DAVET LİNKLERİ</span>
      <div className="lan-share-panel__content">
        {network.status === 'loading' && lanAddresses.length === 0 ? (
          <span className="lan-share-panel__message">Adres aranıyor…</span>
        ) : null}
        {lanAddresses.length > 0 ? (
          <ul className="lan-share-panel__addresses" aria-label="LAN adresleri">
            {lanAddresses.map((address) => {
              const inviteUrl = buildRoomInviteUrl(address.url, roomCode);
              return (
              <li className="lan-share-panel__address" key={`${address.interfaceName}-${address.address}`}>
                <span className="lan-share-panel__interface">{address.interfaceName}</span>
                <a
                  className="lan-share-panel__url focus-ring"
                  href={inviteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {inviteUrl}
                </a>
                <button
                  className="lan-share-panel__copy focus-ring"
                  type="button"
                  aria-label={`${inviteUrl} adresini kopyala`}
                  onClick={() => void copyLink(inviteUrl)}
                >
                  Kopyala
                </button>
              </li>
              );
            })}
          </ul>
        ) : null}
        {network.status === 'ready' && lanAddresses.length === 0 ? (
          <p className="lan-share-panel__help">
            Aynı Wi-Fi veya özel ağa bağlı olduğunuzu doğrulayın; misafir ağı veya istemci izolasyonunu kapatın,
            host güvenlik duvarında Node.js'e izin verin ve eski adresi kullanmadığınızdan emin olmak için yenileyin.
          </p>
        ) : null}
        {network.status === 'error' ? <span className="lan-share-panel__error" role="alert">LAN adresi alınamadı.</span> : null}
        <p className="lan-share-panel__transport-guide">
          Önce WebSocket denenir; polling otomatik yedektir. İkisi de misafir ağı izolasyonunu veya host güvenlik duvarını aşmaz.
        </p>
      </div>
      <div className="lan-share-panel__actions">
        <button
          className="lan-share-panel__refresh focus-ring"
          type="button"
          aria-label="LAN adresini yenile"
          disabled={network.status === 'loading'}
          onClick={refreshNetworkInfo}
        >
          Yenile
        </button>
      </div>
      {copyFeedback ? (
        <span className={`lan-share-panel__copy-feedback is-${copyFeedback.status}`} role="status">
          {copyFeedbackMessage(copyFeedback)}
        </span>
      ) : null}
    </aside>
  );
}
