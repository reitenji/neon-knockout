import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanSharePanel, type LanSharePanelProps } from './LanSharePanel.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function networkInfo(addresses: readonly string[]): unknown {
  return {
    port: 4173,
    localUrl: 'http://localhost:4173',
    lanAddresses: addresses.map((address, index) => ({
      interfaceName: index === 0 ? 'en0' : 'en1',
      address,
      url: `http://${address}:4173`
    }))
  };
}

function renderPanel(
  responses: readonly unknown[],
  clipboard: LanSharePanelProps['clipboard'] = { writeText: async () => undefined }
) {
  let responseIndex = 0;
  const fetchImpl: NonNullable<LanSharePanelProps['fetchImpl']> = async () => {
    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;
    if (response instanceof Error) throw response;
    return jsonResponse(response);
  };

  return render(<LanSharePanel fetchImpl={fetchImpl} clipboard={clipboard} />);
}

describe('LanSharePanel', () => {
  afterEach(cleanup);

  it('shows the first live LAN URL and copies that connection link', async () => {
    const copied: string[] = [];
    renderPanel(
      [networkInfo(['192.168.68.51', '10.0.0.8'])],
      { writeText: async (value) => { copied.push(value); } }
    );

    const link = await screen.findByRole('link', { name: 'http://192.168.68.51:4173' });
    expect(link).toHaveAttribute('href', 'http://192.168.68.51:4173');
    expect(screen.queryByText('http://10.0.0.8:4173')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bağlantı Linkini Kopyala' }));

    await waitFor(() => expect(copied).toEqual(['http://192.168.68.51:4173']));
    expect(screen.getByRole('status')).toHaveTextContent('Bağlantı linki kopyalandı.');
  });

  it('refreshes the LAN URL so a changed DHCP address replaces the stale one', async () => {
    renderPanel([
      networkInfo(['192.168.68.51']),
      networkInfo(['192.168.68.77'])
    ]);
    await screen.findByRole('link', { name: 'http://192.168.68.51:4173' });

    fireEvent.click(screen.getByRole('button', { name: 'LAN adresini yenile' }));

    expect(await screen.findByRole('link', { name: 'http://192.168.68.77:4173' })).toBeVisible();
    expect(screen.queryByText('http://192.168.68.51:4173')).toBeNull();
  });

  it('explains the actionable LAN checks when the host has no shareable address', async () => {
    renderPanel([networkInfo([])]);

    expect(await screen.findByText(/Aynı Wi-Fi veya özel ağa bağlı olduğunuzu doğrulayın/i)).toBeVisible();
    expect(screen.getByText(/misafir ağı veya istemci izolasyonu/i)).toBeVisible();
    expect(screen.getByText(/güvenlik duvarında Node\.js'e izin verin/i)).toBeVisible();
    expect(screen.getByText(/eski adresi kullanmadığınızdan emin olmak için yenileyin/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Bağlantı Linkini Kopyala' })).toBeNull();
  });

  it('keeps a refresh path visible when network discovery fails', async () => {
    renderPanel([new Error('offline')]);

    expect(await screen.findByRole('alert')).toHaveTextContent('LAN adresi alınamadı.');
    expect(screen.getByRole('button', { name: 'LAN adresini yenile' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Bağlantı Linkini Kopyala' })).toBeNull();
  });
});
