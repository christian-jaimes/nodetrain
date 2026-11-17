import type { NodeProps } from '@xyflow/react';
import { ImagePlus, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import type { ImageInputNode as ImageInputNodeType } from '../../../shared/graph/types';
import { importImage } from '../../lib/images';
import { useBoard } from '../../store/board';
import { ImageMosaic, NodeShell } from './parts';

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
        <button className="icon-btn nodrag" title="Upload images" aria-label="Upload images" onClick={() => fileRef.current?.click()}>
          <Upload size={16} />
        </button>
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
        {images.length === 0 ? (
          <button className="image-empty nodrag" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={22} />
            <span>Drop images or click to upload</span>
          </button>
        ) : (
          <ImageMosaic images={images} />
        )}
      </div>
    </NodeShell>
  );
}
