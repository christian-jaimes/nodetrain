import { describe, expect, it } from 'vitest';
import type { BoardSummary } from '../shared/api';
import { layoutPreview, timeAgo, visibleBoards } from '../src/lib/gallery';

const b = (id: string, name: string, o: Partial<BoardSummary> = {}): BoardSummary => ({
  id,
  name,
  revision: 1,
  nodeCount: 0,
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
  preview: { nodes: [], edges: [] },
  ...o,
});
const boards = [b('a', 'Banana shots', { updatedAt: 10, createdAt: 30, favorite: true }), b('c', 'cat poster', { updatedAt: 30, createdAt: 10 }), b('b', 'Apple ads', { updatedAt: 20, createdAt: 20, favorite: true })];
const base = { query: '', filter: 'all' as const, sort: 'modified' as const };

describe('gallery list', () => {
  it('sorts by last modified, created and name', () => {
    expect(visibleBoards(boards, base).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(visibleBoards(boards, { ...base, sort: 'created' }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(visibleBoards(boards, { ...base, sort: 'name' }).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
  it('filters favorites and searches names case-insensitively', () => {
    expect(visibleBoards(boards, { ...base, filter: 'favorites' }).map((x) => x.id)).toEqual(['b', 'a']);
    expect(visibleBoards(boards, { ...base, query: ' CAT ' }).map((x) => x.id)).toEqual(['c']);
    expect(visibleBoards(boards, { ...base, filter: 'favorites', query: 'cat' })).toEqual([]);
  });
  it('does not mutate its input', () => {
    const copy = [...boards];
    visibleBoards(boards, { ...base, sort: 'name' });
    expect(boards).toEqual(copy);
  });
  it('formats relative times', () => {
    expect(timeAgo(1000, 1000)).toBe('just now');
    expect(timeAgo(0, 2 * 3600 * 1000)).toBe('2h ago');
    expect(timeAgo(0, 3 * 86400 * 1000)).toBe('3d ago');
  });
  it('lays out previews inside the thumbnail box, including a single node', () => {
    const p = layoutPreview({ nodes: [{ id: '1', x: 500, y: 40, type: 'prompt' }, { id: '2', x: 1400, y: 300, type: 'imageGeneration' }], edges: [{ source: '1', target: '2' }, { source: '1', target: 'gone' }] });
    expect(p.nodes).toHaveLength(2);
    expect(p.edges).toHaveLength(1);
    for (const n of p.nodes) expect(n.x >= 0 && n.x + 18 <= p.width && n.y >= 0 && n.y + 9 <= p.height).toBe(true);
    expect(layoutPreview({ nodes: [{ id: '1', x: 7, y: 7, type: 'prompt' }], edges: [] }).nodes).toHaveLength(1);
  });
});
