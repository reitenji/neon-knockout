import { useEffect, useRef, useState } from 'react';
import type { RuntimeNetworkInfo } from '../../shared/runtime.js';
import '../styles/lan-share.css';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ClipboardLike = Readonly<{ writeText: (value: string) => Promise<void> }>;

export type LanSharePanelProps = Readonly<{
  fetchImpl?: FetchLike;
  clipboard?: ClipboardLike;
}>;

type NetworkState = Readonly<{
  status: 'loading' | 'ready' | 'error';
  info: RuntimeNetworkInfo | null;
}>;

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

export function LanSharePanel({ fetchImpl = defaultFetch, clipboard }: LanSharePanelProps) {
  const [network, setNetwork] = useState<NetworkState>({ status: 'loading', info: null });
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    void readNetworkInfo(fetchImpl).then((body) => {
      if (generation === requestGeneration.current) {
        setNetwork({ status: 'ready', info: body });
        setCopyFeedback('idle');
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
        setCopyFeedback('idle');
      }
    }, () => {
      if (generation === requestGeneration.current) setNetwork({ status: 'error', info: null });
    });
  };

  const lanUrl = network.info?.lanAddresses[0]?.url ?? null;
  const copyLink = async (): Promise<void> => {
    if (!lanUrl) return;
    try {
      await (clipboard?.writeText(lanUrl) ?? defaultCopy(lanUrl));
      setCopyFeedback('copied');
    } catch {
      setCopyFeedback('failed');
    }
  };

  return (
    <aside className="lan-share-panel" aria-label="LAN bağlantısı" aria-busy={network.status === 'loading'}>
      <span className="lan-share-panel__label">LAN ADRESİ</span>
      <div className="lan-share-panel__content">
        {network.status === 'loading' && !lanUrl ? <span className="lan-share-panel__message">Adres aranıyor…</span> : null}
        {lanUrl ? (
          <a className="lan-share-panel__url focus-ring" href={lanUrl} target="_blank" rel="noreferrer">
            {lanUrl}
          </a>
        ) : null}
        {network.status === 'ready' && !lanUrl ? (
          <p className="lan-share-panel__help">
            Aynı Wi-Fi veya özel ağa bağlı olduğunuzu doğrulayın; misafir ağı veya istemci izolasyonunu kapatın,
            host güvenlik duvarında Node.js'e izin verin ve eski adresi kullanmadığınızdan emin olmak için yenileyin.
          </p>
        ) : null}
        {network.status === 'error' ? <span className="lan-share-panel__error" role="alert">LAN adresi alınamadı.</span> : null}
      </div>
      <div className="lan-share-panel__actions">
        {lanUrl ? (
          <button className="lan-share-panel__button focus-ring" type="button" onClick={() => void copyLink()}>
            Bağlantı Linkini Kopyala
          </button>
        ) : null}
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
      {copyFeedback !== 'idle' ? (
        <span className={`lan-share-panel__copy-feedback is-${copyFeedback}`} role="status">
          {copyFeedback === 'copied' ? 'Bağlantı linki kopyalandı.' : 'Bağlantı linki kopyalanamadı.'}
        </span>
      ) : null}
    </aside>
  );
}
