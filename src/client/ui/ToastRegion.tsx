import type { Toast } from '../state/gameStore.js';

type ToastRegionProps = Readonly<{
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
}>;

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <aside className="toast-region" aria-live="polite" aria-label="Durum bildirimleri">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.tone}`} role="status" key={toast.id}>
          <span>{toast.message}</span>
          <button className="toast__dismiss focus-ring" type="button" aria-label="Bildirimi kapat" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
