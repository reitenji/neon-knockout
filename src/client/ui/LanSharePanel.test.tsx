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

  return render(<LanSharePanel roomCode="AB2Z" fetchImpl={fetchImpl} clipboard={clipboard} />);
}

describe('LanSharePanel', () => {
  afterEach(cleanup);

  it('shows every LAN invite URL with equal weight and copies each address independently', async () => {
    const copied: string[] = [];
    renderPanel(
      [networkInfo(['192.168.68.51', '10.0.0.8'])],
      { writeText: async (value) => { copied.push(value); } }
    );

    const firstLink = await screen.findByRole('link', { name: 'http://192.168.68.51:4173/room/AB2Z' });
    const secondLink = screen.getByRole('link', { name: 'http://10.0.0.8:4173/room/AB2Z' });
    expect(firstLink).toHaveAttribute('href', 'http://192.168.68.51:4173/room/AB2Z');
    expect(secondLink).toHaveAttribute('href', 'http://10.0.0.8:4173/room/AB2Z');
    expect(screen.queryByRole('link', { name: 'http://192.168.68.51:4173' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'http://10.0.0.8:4173' })).toBeNull();
    expect(screen.getByText('en0')).toBeVisible();
    expect(screen.getByText('en1')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'http://192.168.68.51:4173/room/AB2Z adresini kopyala' }));

    await waitFor(() => expect(copied).toEqual(['http://192.168.68.51:4173/room/AB2Z']));
    expect(screen.getByRole('status')).toHaveTextContent('http://192.168.68.51:4173/room/AB2Z kopyalandı.');

    fireEvent.click(screen.getByRole('button', { name: 'http://10.0.0.8:4173/room/AB2Z adresini kopyala' }));

    await waitFor(() => {
      expect(copied).toEqual([
        'http://192.168.68.51:4173/room/AB2Z',
        'http://10.0.0.8:4173/room/AB2Z'
      ]);
    });
    expect(screen.getByRole('status')).toHaveTextContent('http://10.0.0.8:4173/room/AB2Z kopyalandı.');
    expect(screen.getByText(/Önce WebSocket denenir; polling otomatik yedektir/i)).toBeVisible();
    expect(screen.getByText(/misafir ağı izolasyonunu veya host güvenlik duvarını aşmaz/i)).toBeVisible();
  });

  it('refreshes the LAN URL so a changed DHCP address replaces the stale one', async () => {
    renderPanel([
      networkInfo(['192.168.68.51']),
      networkInfo(['192.168.68.77'])
    ]);
    await screen.findByRole('link', { name: 'http://192.168.68.51:4173/room/AB2Z' });

    fireEvent.click(screen.getByRole('button', { name: 'LAN adresini yenile' }));

    expect(await screen.findByRole('link', { name: 'http://192.168.68.77:4173/room/AB2Z' })).toBeVisible();
    expect(screen.queryByText('http://192.168.68.51:4173/room/AB2Z')).toBeNull();
  });

  it('explains the actionable LAN checks when the host has no shareable address', async () => {
    renderPanel([networkInfo([])]);

    expect(await screen.findByText(/Aynı Wi-Fi veya özel ağa bağlı olduğunuzu doğrulayın/i)).toBeVisible();
    expect(screen.getByText(/misafir ağı veya istemci izolasyonu/i)).toBeVisible();
    expect(screen.getByText(/güvenlik duvarında Node\.js'e izin verin/i)).toBeVisible();
    expect(screen.getByText(/eski adresi kullanmadığınızdan emin olmak için yenileyin/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /adresini kopyala/i })).toBeNull();
  });

  it('keeps a refresh path visible when network discovery fails', async () => {
    renderPanel([new Error('offline')]);

    expect(await screen.findByRole('alert')).toHaveTextContent('LAN adresi alınamadı.');
    expect(screen.getByRole('button', { name: 'LAN adresini yenile' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /adresini kopyala/i })).toBeNull();
    expect(screen.getByText(/Önce WebSocket denenir; polling otomatik yedektir/i)).toBeVisible();
  });
});
