import { Image as ImageIcon, Sparkles, Type, Wand2, type LucideIcon } from 'lucide-react';
import type { NodeKind } from '../../shared/graph/types';

export const NODE_ICONS: Record<NodeKind, LucideIcon> = {
  prompt: Type,
  imageInput: ImageIcon,
  imageGeneration: Sparkles,
  imageTransform: Wand2,
};

export function NodeIconTile({ kind, size = 'md' }: { kind: NodeKind; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = NODE_ICONS[kind];
  return (
    <span className={`icon-tile icon-tile--${size} icon-tile--${kind}`} aria-hidden>
      <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 17} strokeWidth={2} />
    </span>
  );
}
