import { useEffect, useRef, type ReactNode } from 'react';
export function Icon({
  name,
}: {
  name:
    | 'plus'
    | 'menu'
    | 'back'
    | 'next'
    | 'close'
    | 'calendar'
    | 'eye'
    | 'copy'
    | 'edit';
}) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    menu: 'M4 6h16M4 12h16M4 18h16',
    back: 'm15 5-7 7 7 7',
    next: 'm9 5 7 7-7 7',
    close: 'm6 6 12 12M6 18 18 6',
    calendar: 'M7 3v4M17 3v4M4 10h16M5 5h14v16H5z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
    edit: 'm4 16-1 5 5-1L20 8l-4-4ZM13 7l4 4',
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      node.style.setProperty('--usable-height', `${height}px`);
      node.style.setProperty(
        '--keyboard-inset',
        `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`,
      );
      requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active && node.contains(active))
          active.scrollIntoView({ block: 'nearest' });
      });
    };
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    window.addEventListener('resize', fitViewport);
    node.showModal();
    node
      .querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)')
      ?.focus();
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      window.removeEventListener('resize', fitViewport);
      node.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="sheet-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Notice({
  error = false,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`notice ${error ? 'error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span>Gym</span> Log
      <span className="brand-dot" />
    </span>
  );
}
