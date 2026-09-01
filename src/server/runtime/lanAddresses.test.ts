import { describe, expect, it } from 'vitest';
import { discoverLanUrls, discoverRuntimeNetworkInfo } from './lanAddresses.js';

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

describe('discoverRuntimeNetworkInfo', () => {
  it('returns only usable physical LAN addresses with their current port', () => {
    expect(discoverRuntimeNetworkInfo(4173, {
      en0: [{ address: '192.168.68.51', family: 'IPv4', internal: false }],
      en1: [{ address: '192.168.68.51', family: 4, internal: false }],
      utun4: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en2: [{ address: '203.0.113.2', family: 'IPv4', internal: false }]
    })).toEqual({
      port: 4173,
      localUrl: 'http://localhost:4173',
      lanAddresses: [
        {
          interfaceName: 'en0',
          address: '192.168.68.51',
          url: 'http://192.168.68.51:4173'
        }
      ]
    });
  });
});
