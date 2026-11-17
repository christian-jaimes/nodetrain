import { Handle, Position, useNodeId } from '@xyflow/react';
import { CircleDashed, Check, Clock, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CATALOG, PORT_TYPE_LABEL } from '../../../shared/graph/catalog';
import type { ImageAsset, NodeKind, PortDef, RunStatus } from '../../../shared/graph/types';
import { NODE_WIDTH } from '../../lib/ui';
import { useBoard } from '../../store/board';
import { NodeIconTile } from '../icons';

/** The node name. Double-click it on the canvas to rename: Enter or clicking away saves, Escape cancels. */
export function EditableTitle({ nodeId, title }: { nodeId: string; title: string }) {
  const updateData = useBoard((s) => s.updateData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const done = useRef(false);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim().slice(0, 80);
    if (save && next && next !== title) updateData(nodeId, { title: next }, `title:${nodeId}`);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div
        className="nt-node__title"
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          done.current = false;
          setDraft(title);
          setEditing(true);
        }}
      >
        {title}
      </div>
    );
  }
  return (
    <input
      className="nt-node__title-input nodrag nowheel"
      aria-label="Node name"
      autoFocus
      maxLength={80}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/**
 * The card every node uses. Header: icon, then name (editable) over node type, then whatever the node puts on the
 * right (status, run button). All cards share one width.
 */
export function NodeShell({
  id,
  kind,
  title,
  selected,
  action,
  children,
}: {
  id: string;
  kind: NodeKind;
  title: string;
  selected?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`nt-node ${selected ? 'is-selected' : ''}`} style={{ width: NODE_WIDTH }}>
      <div className="nt-node__header">
        <NodeIconTile kind={kind} />
        <div className="nt-node__titles">
          <EditableTitle nodeId={id} title={title} />
          <div className="nt-node__subtitle">{CATALOG[kind].label}</div>
        </div>
        {action ? <div className="nt-node__actions">{action}</div> : null}
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

/** Node status as an icon; the detail is in the tooltip and read out by screen readers. */
export function StatusIcon({ status, detail }: { status: RunStatus | 'stale'; detail?: string }) {
  const { label, Icon } = STATUS[status];
  const text = detail ? `${label}: ${detail}` : label;
  return (
    <span className={`status-icon status-icon--${status}`} role="img" title={text} aria-label={`Status: ${text}`}>
      <Icon size={16} className={status === 'running' ? 'spin' : undefined} aria-hidden />
    </span>
  );
}

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
export function ImageMosaic({ images, alt, onPick }: { images: ImageAsset[]; alt?: (img: ImageAsset) => string; onPick?: (id: string) => void }) {
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
        <img key={img.id} src={img.thumb ?? img.src} alt={label(img)} draggable={false} className={onPick ? 'is-pickable' : undefined} title={onPick ? 'Click to use only this image' : undefined} onClick={onPick ? () => onPick(img.id) : undefined} />
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
  fit = 'box',
}: {
  /** 'box': keep the area a single image would take (crops slightly to make room for the strip). 'natural': image at its own ratio. */
  fit?: 'box' | 'natural';
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
    <div className={`output-gallery output-gallery--${fit}`} style={fit === 'box' ? { aspectRatio: `${big.width} / ${big.height}` } : undefined}>
      <img className="output-gallery__big" src={big.src} alt={alt ? alt(big) : big.name} draggable={false} />
      {images.length > 1 ? (
        <div className="output-gallery__thumbs nodrag nowheel" role="group" aria-label="Generations">
          {images.map((img, i) => {
            const on = img.id === picked?.id;
            return (
              <button
                key={img.id}
                type="button"
                className={`output-gallery__thumb ${on ? 'is-active' : ''}`}
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
