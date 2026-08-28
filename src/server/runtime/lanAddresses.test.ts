import { describe, expect, it } from 'vitest';
import { discoverLanUrls } from './lanAddresses.js';

describe('discoverLanUrls', () => {
  it('includes private LAN and VPN IPv4 addresses while excluding public addresses', () => {
    expect(discoverLanUrls(4173, {
      en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
      utun4: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
      en1: [{ address: '203.0.113.2', family: 'IPv4', internal: false }]
    })).toEqual([
      { url: 'http://localhost:4173', kind: 'local' },
      { url: 'http://192.168.1.10:4173', kind: 'lan' },
      { url: 'http://10.8.0.2:4173', kind: 'virtual' }
    ]);
  });

  it('returns localhost once when interfaces are absent or unusable', () => {
    expect(discoverLanUrls(8080, {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
      en1: undefined
    })).toEqual([{ url: 'http://localhost:8080', kind: 'local' }]);
  });
});
