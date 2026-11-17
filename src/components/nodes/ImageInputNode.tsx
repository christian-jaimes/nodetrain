import type { NodeProps } from '@xyflow/react';
import { ImagePlus, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { CATALOG } from '../../../shared/graph/catalog';
import type { ImageInputNode as ImageInputNodeType } from '../../../shared/graph/types';
import { importImage } from '../../lib/images';
import { useBoard } from '../../store/board';
import { NodeShell, Port } from './parts';

export function useImageImport(nodeId: string) {
  const notify = useBoard((s) => s.notify);
  return async (files: FileList | File[]) => {
    const list = Array.from(files);
    const results = await Promise.allSettled(list.map(importImage));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error).message)] : []));
    if (ok.length) {
      const { nodes, updateData } = useBoard.getState();
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type === 'imageInput') updateData(nodeId, { images: [...node.data.images, ...ok] }, `import:${Date.now()}`);
    }
    if (errors.length) notify(errors[0], 'error');
  };
}

export function ImageInputNode({ id, data, selected }: NodeProps<ImageInputNodeType>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const importFiles = useImageImport(id);
  const images = data.images;
  const first = images[0];
  const tiles = images.length > 4 ? images.slice(0, 3) : images;
  const more = images.length > 4 ? images.length - 3 : 0;
  // Card height follows the first image's shape; clamped so the mosaic never gets extreme.
  const ratio = first ? Math.min(1.4, Math.max(0.75, first.width / first.height)) : 1;

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    void importFiles(e.dataTransfer.files);
  };

  return (
    <NodeShell
      kind="imageInput"
      title={data.title}
      selected={selected}
      width={300}
      action={
        <>
          <button className="icon-btn nodrag" title="Upload images" aria-label="Upload images" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
          </button>
          <Port port={CATALOG.imageInput.outputs[0]} side="out" />
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        className={`image-drop ${dragOver ? 'is-over' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {!first ? (
          <button className="image-empty nodrag" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={22} />
            <span>Drop images or click to upload</span>
          </button>
        ) : images.length === 1 ? (
          <img
            className="image-single"
            src={first.thumb ?? first.src}
            alt={first.name}
            width={first.width}
            height={first.height}
            style={{ aspectRatio: `${first.width} / ${first.height}` }}
            draggable={false}
          />
        ) : (
          <div className={`image-grid image-grid--${tiles.length + (more ? 1 : 0)}`} style={{ aspectRatio: String(ratio) }}>
            {tiles.map((img) => (
              <img key={img.id} src={img.thumb ?? img.src} alt={img.name} draggable={false} />
            ))}
            {more > 0 && <span className="image-grid__more">+{more} more</span>}
          </div>
        )}
      </div>
    </NodeShell>
  );
}
