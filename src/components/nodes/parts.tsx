import { Handle, Position } from '@xyflow/react';
import { CircleDashed, Check, Clock, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CATALOG, PORT_TYPE_LABEL } from '../../graph/catalog';
import type { NodeKind, PortDef, RunStatus } from '../../graph/types';
import { NodeIconTile } from '../icons';

export function NodeShell({
  kind,
  title,
  selected,
  action,
  children,
  width,
  status,
}: {
  kind: NodeKind;
  title: string;
  selected?: boolean;
  action?: ReactNode;
  children: ReactNode;
  width: number;
  status?: ReactNode;
}) {
  return (
    <div className={`nt-node ${selected ? 'is-selected' : ''}`} style={{ width }}>
      <header className="nt-node__header">
        <NodeIconTile kind={kind} />
        <div className="nt-node__titles">
          <div className="nt-node__title">{title}</div>
          <div className="nt-node__subtitle">{CATALOG[kind].label}</div>
        </div>
        {action}
      </header>
      {status}
      <div className="nt-node__body">{children}</div>
    </div>
  );
}

/** A typed port. Type is shown by shape, colour and a tooltip, never colour alone. */
export function Port({ port, side, style }: { port: PortDef; side: 'in' | 'out'; style?: CSSProperties }) {
  return (
    <Handle
      id={port.id}
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      className={`nt-port nt-port--${port.type}`}
      style={style}
      title={`${port.label} · ${PORT_TYPE_LABEL[port.type]}${port.multi ? ' (accepts several)' : ''}`}
      aria-label={`${side === 'in' ? 'Input' : 'Output'}: ${port.label}, type ${PORT_TYPE_LABEL[port.type]}`}
    />
  );
}

const STATUS: Record<RunStatus | 'stale', { label: string; Icon: typeof Check }> = {
  idle: { label: 'Not run yet', Icon: CircleDashed },
  queued: { label: 'Queued', Icon: Clock },
  running: { label: 'Generating…', Icon: LoaderCircle },
  succeeded: { label: 'Up to date', Icon: Check },
  failed: { label: 'Failed', Icon: TriangleAlert },
  stale: { label: 'Out of date: inputs changed', Icon: RefreshCw },
};

export function StatusChip({ status }: { status: RunStatus | 'stale' }) {
  const { label, Icon } = STATUS[status];
  return (
    <span className={`status-chip status-chip--${status}`}>
      <Icon size={13} className={status === 'running' ? 'spin' : undefined} aria-hidden />
      {label}
    </span>
  );
}
