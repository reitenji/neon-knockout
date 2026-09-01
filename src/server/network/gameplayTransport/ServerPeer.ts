import type { RtcAnswer, RtcOffer } from '../../../shared/gameplayTransport.js';

export type PeerSendResult = 'sent' | 'backpressured' | 'closed';

export interface ServerPeer {
  readonly generationId: string;
  negotiate(offer: RtcOffer): Promise<RtcAnswer>;
  isReady(): boolean;
  sendFast(serialized: string): PeerSendResult;
  sendReliable(serialized: string): PeerSendResult;
  sampleRttMs(): Promise<number | null>;
  onFastMessage(listener: (serialized: string) => void): () => void;
  onReliableMessage(listener: (serialized: string) => void): () => void;
  onClosed(listener: () => void): () => void;
  close(): Promise<void>;
}

export type ServerPeerFactory = (options: Readonly<{
  generationId: string;
  udpPortRange: readonly [number, number];
}>) => ServerPeer;
