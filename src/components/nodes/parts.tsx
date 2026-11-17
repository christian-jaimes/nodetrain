import { Handle, Position, useNodeId } from '@xyflow/react';
import { CircleDashed, Check, Clock, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { CATALOG, PORT_TYPE_LABEL } from '../../../shared/graph/catalog';
import type { ImageAsset, NodeKind, PortDef, RunStatus } from '../../../shared/graph/types';
import { useBoard } from '../../store/board';
import { NodeIconTile } from '../icons';

export function NodeShell({
  kind,
  title,
  selected,
  action,
  children,
  width,
  hideSubtitle,
}: {
  kind: NodeKind;
  title: string;
  selected?: boolean;
  action?: ReactNode;
  children: ReactNode;
  width: number;
  /** Leave out the node type line under the name. */
  hideSubtitle?: boolean;
}) {
  return (
    <div className={`nt-node ${selected ? 'is-selected' : ''}`} style={{ width }}>
      <div className="nt-node__header">
        <NodeIconTile kind={kind} />
        <div className="nt-node__titles">
          <div className="nt-node__title">{title}</div>
          {hideSubtitle ? null : <div className="nt-node__subtitle">{CATALOG[kind].label}</div>}
        </div>
        {action}
        {CATALOG[kind].inputs.map((p, i) => (
          <Port key={p.id} port={p} side="in" index={i} />
        ))}
        {CATALOG[kind].outputs.map((p) => (
          <Port key={p.id} port={p} side="out" />
        ))}
      </div>
      <div className="nt-node__body">{children}</div>
    </div>
  );
}

/**
 * A typed port. Type is shown by shape, colour and a tooltip, never colour alone.
 * Nodes connect by dropping one onto another, so a port only shows once it has a link, at the top corner of the node:
 * inputs on the left, the output on the right. `index` stacks a node's further inputs below the first.
 */
export function Port({ port, side, index = 0 }: { port: PortDef; side: 'in' | 'out'; index?: number }) {
  const nodeId = useNodeId();
  const connected = useBoard((s) =>
    s.edges.some((e) => (side === 'out' ? e.source === nodeId && e.sourceHandle === port.id : e.target === nodeId && e.targetHandle === port.id)),
  );
  return (
    <Handle
      id={port.id}
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      className={`nt-port nt-port--${port.type} ${connected ? 'is-connected' : 'is-idle'}`}
      style={index ? { top: `calc(50% + ${index * 26}px)` } : undefined}
      role="img"
      title={`${port.label} · ${PORT_TYPE_LABEL[port.type]}${port.multi ? ' (accepts several)' : ''}`}
      aria-label={`${side === 'in' ? 'Input' : 'Output'}: ${port.label}, type ${PORT_TYPE_LABEL[port.type]}${connected ? ', connected' : ''}`}
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

/**
 * Gallery of a node's generations: the selected image large (the newest when none is selected), every generation as a
 * small thumbnail beneath it. Clicking a thumbnail selects it; clicking the selected one again clears the selection.
 */
export function OutputGallery({
  images,
  selectedId,
  onSelect,
  alt,
}: {
  images: ImageAsset[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  alt?: (img: ImageAsset) => string;
}) {
  const picked = images.find((i) => i.id === selectedId);
  const big = picked ?? images[0];
  if (!big) return null;
  return (
    // The gallery takes the same box a single image would, so the card keeps its size; the big image shrinks to make room for the strip.
    <div className="gallery" style={{ aspectRatio: `${big.width} / ${big.height}` }}>
      <img className="gallery__big" src={big.src} alt={alt ? alt(big) : big.name} draggable={false} />
      {images.length > 1 ? (
        <div className="gallery__thumbs nodrag nowheel" role="group" aria-label="Generations">
          {images.map((img, i) => {
            const on = img.id === picked?.id;
            return (
              <button
                key={img.id}
                type="button"
                className={`gallery__thumb ${on ? 'is-active' : ''}`}
                aria-pressed={on}
                aria-label={`Version ${images.length - i}`}
                title={on ? 'Click to deselect' : 'Click to use only this image as the reference'}
                onClick={() => onSelect(on ? undefined : img.id)}
              >
                <img src={img.thumb ?? img.src} alt="" draggable={false} />
                {on ? (
                  <i className="version__check" aria-hidden>
                    <Check size={12} strokeWidth={3} />
                  </i>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
