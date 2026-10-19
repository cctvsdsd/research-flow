import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuEntry =
  | { kind: 'title'; label: string }
  | { kind: 'item'; label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { kind: 'sep' };

export default function ContextMenu({
  x,
  y,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 贴边翻转，避免菜单被视口裁掉
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x;
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ left, top });
  }, [x, y, entries.length]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // 捕获阶段监听：确保在任何其它面板的点击之前关闭
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((m, i) =>
        m.kind === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : m.kind === 'title' ? (
          <div key={i} className="ctx-title">
            {m.label}
          </div>
        ) : (
          <button
            key={i}
            className={`ctx-item${m.danger ? ' danger' : ''}`}
            disabled={m.disabled}
            onClick={() => {
              if (m.disabled) return;
              onClose();
              m.onClick();
            }}
          >
            <span>{m.label}</span>
            {m.hint && <i>{m.hint}</i>}
          </button>
        ),
      )}
    </div>
  );
}
