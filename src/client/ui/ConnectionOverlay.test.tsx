import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionOverlay } from './ConnectionOverlay.js';

describe('ConnectionOverlay', () => {
  afterEach(cleanup);

  it('rounds the authoritative reconnect window up without replacing the last game frame', () => {
    render(
      <div>
        <canvas data-testid="last-game-frame" />
        <ConnectionOverlay connectionState="reconnecting" remainingMs={12_400} onRetry={() => undefined} />
      </div>
    );
    expect(screen.getByRole('dialog', { name: 'Bağlantı kesildi' })).toHaveTextContent('13 saniye');
    expect(screen.getByTestId('last-game-frame')).toBeInTheDocument();
  });

  it('offers a retry action after the transport is fully disconnected', () => {
    const retry = vi.fn();
    render(<ConnectionOverlay connectionState="disconnected" remainingMs={0} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden Dene' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('explains an authoritative opponent reservation while the local transport stays connected', () => {
    render(<ConnectionOverlay connectionState="connected" remainingMs={8_100} onRetry={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Rakip bekleniyor' })).toHaveTextContent('9 saniye');
    expect(screen.queryByRole('button', { name: 'Yeniden Dene' })).toBeNull();
  });
});
