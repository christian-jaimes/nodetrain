import { Handle, Position } from '@xyflow/react';
import { CircleDashed, Check, Clock, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CATALOG, PORT_TYPE_LABEL } from '../../../shared/graph/catalog';
import type { ImageAsset, NodeKind, PortDef, RunStatus } from '../../../shared/graph/types';
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
      <div className="nt-node__header">
        <NodeIconTile kind={kind} />
        <div className="nt-node__titles">
          <div className="nt-node__title">{title}</div>
          <div className="nt-node__subtitle">{CATALOG[kind].label}</div>
        </div>
        {action}
      </div>
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
      role="img"
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

/** One image fills the width at its own aspect ratio; several become a mosaic of at most 4 tiles, the 4th reading "+N more". */
export function ImageMosaic({ images, alt }: { images: ImageAsset[]; alt?: (img: ImageAsset) => string }) {
  const first = images[0];
  if (!first) return null;
  const label = (img: ImageAsset) => (alt ? alt(img) : img.name);
  if (images.length === 1) {
    return (
      <img
        className="image-single"
        src={first.thumb ?? first.src}
        alt={label(first)}
        width={first.width}
        height={first.height}
        style={{ aspectRatio: `${first.width} / ${first.height}` }}
        draggable={false}
      />
    );
  }
  const tiles = images.length > 4 ? images.slice(0, 3) : images;
  const more = images.length > 4 ? images.length - 3 : 0;
  // Height follows the first image's shape, clamped so the mosaic never gets extreme.
  const ratio = Math.min(1.4, Math.max(0.75, first.width / first.height));
  return (
    <div className={`image-grid image-grid--${tiles.length + (more ? 1 : 0)}`} style={{ aspectRatio: String(ratio) }}>
      {tiles.map((img) => (
        <img key={img.id} src={img.thumb ?? img.src} alt={label(img)} draggable={false} />
      ))}
      {more > 0 && <span className="image-grid__more">+{more} more</span>}
    </div>
  );
}
