import { STATUS_COLOR, STATUS_LABEL, Status, Derived } from '../types';

export function StatusPill({ status, small }: { status: Status; small?: boolean }) {
  return (
    <span className={`pill s-${status}`} style={small ? { fontSize: 10, padding: '1px 6px' } : undefined}>
      <i className="dot" style={{ background: STATUS_COLOR[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressBar({ value, color, height = 4 }: { value: number; color: string; height?: number }) {
  return (
    <div className="node-bar" style={{ height }}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

export function statusColor(d: Derived | undefined, fallback = '#64748b'): string {
  return d ? STATUS_COLOR[d.status] : fallback;
}
