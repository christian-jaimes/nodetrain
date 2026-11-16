import type { BoardSummary } from '../../shared/api';

export type GallerySort = 'modified' | 'created' | 'name';
export type GalleryView = {
  query: string;
  filter: 'all' | 'favorites';
  sort: GallerySort;
  layout: 'grid' | 'list';
};

export const DEFAULT_GALLERY: GalleryView = { query: '', filter: 'all', sort: 'modified', layout: 'grid' };

export const SORT_LABELS: Record<GallerySort, string> = { modified: 'Last modified', created: 'Date created', name: 'Name' };

/** Search by name, optionally favorites only, then sort. Newest first for dates, A to Z for names. */
export function visibleBoards(boards: BoardSummary[], { query, filter, sort }: Pick<GalleryView, 'query' | 'filter' | 'sort'>): BoardSummary[] {
  const q = query.trim().toLowerCase();
  const list = boards.filter((b) => (filter === 'all' || b.favorite) && (!q || b.name.toLowerCase().includes(q)));
  const by: Record<GallerySort, (a: BoardSummary, b: BoardSummary) => number> = {
    modified: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  };
  return [...list].sort(by[sort]);
}

export function timeAgo(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

const W = 120;
const H = 56;
const NODE_W = 18;
const NODE_H = 9;

/** Lays a workflow's nodes out inside a small box for the card thumbnail. */
export function layoutPreview(preview: BoardSummary['preview']) {
  const { nodes, edges } = preview;
  if (!nodes.length) return { width: W, height: H, nodes: [], edges: [] };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // Real nodes are roughly 300x260 on the canvas; spread positions over that footprint.
  const spanX = Math.max(...xs) - minX + 300;
  const spanY = Math.max(...ys) - minY + 260;
  const scale = Math.min((W - 8 - NODE_W) / Math.max(spanX - 300, 1), (H - 8 - NODE_H) / Math.max(spanY - 260, 1), 0.06);
  const w = (Math.max(...xs) - minX) * scale + NODE_W;
  const h = (Math.max(...ys) - minY) * scale + NODE_H;
  const ox = (W - w) / 2;
  const oy = (H - h) / 2;
  const placed = nodes.map((n) => ({ id: n.id, type: n.type, x: ox + (n.x - minX) * scale, y: oy + (n.y - minY) * scale }));
  const at = new Map(placed.map((n) => [n.id, n]));
  const links = edges.flatMap((e) => {
    const a = at.get(e.source);
    const b = at.get(e.target);
    if (!a || !b) return [];
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return [`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`];
  });
  return { width: W, height: H, nodes: placed, edges: links, nodeW: NODE_W, nodeH: NODE_H };
}
