export type LanUrl = Readonly<{
  url: string;
  kind: 'local' | 'lan' | 'virtual';
}>;

type NetworkAddress = Readonly<{
  address: string;
  family: string | number;
  internal: boolean;
}>;

export type NetworkInterfaces = Readonly<Record<string, readonly NetworkAddress[] | undefined>>;

const VIRTUAL_INTERFACE = /^(?:utun|tun|tap|ppp|vmnet|docker|bridge)/iu;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function discoverLanUrls(port: number, interfaces: NetworkInterfaces): LanUrl[] {
  const urls: LanUrl[] = [{ url: `http://localhost:${port}`, kind: 'local' }];
  const seen = new Set<string>();

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.internal || (address.family !== 'IPv4' && address.family !== 4) || !isPrivateIpv4(address.address)) {
        continue;
      }
      const url = `http://${address.address}:${port}`;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push({ url, kind: VIRTUAL_INTERFACE.test(name) ? 'virtual' : 'lan' });
    }
  }

  return urls;
}
