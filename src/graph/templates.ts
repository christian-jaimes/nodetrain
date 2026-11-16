import { nanoid } from 'nanoid';
import { CATALOG } from '../../shared/graph/catalog';
import type { AppEdge, AppNode, ImageGenerationData, NodeKind } from '../../shared/graph/types';
import { sampleBackdrop, sampleBottle, uploadDataUrl } from '../lib/images';

export type Template = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Node kinds shown on the template card. */
  preview: NodeKind[];
  build: () => Promise<{ name: string; nodes: AppNode[]; edges: AppEdge[] }>;
};

function node(kind: NodeKind, x: number, y: number, patch: Record<string, unknown> = {}): AppNode {
  return { id: nanoid(8), type: kind, position: { x, y }, data: { ...CATALOG[kind].create(), ...patch } } as AppNode;
}

function edge(source: AppNode, target: AppNode, targetHandle: 'prompt' | 'references'): AppEdge {
  const sourceHandle = CATALOG[source.type as NodeKind].outputs[0].id;
  return { id: nanoid(8), source: source.id, target: target.id, sourceHandle, targetHandle };
}

const gen = (patch: Partial<ImageGenerationData>) => patch as Record<string, unknown>;

export const TEMPLATES: Template[] = [
  {
    id: 'product-photography',
    name: 'Product photography',
    description: 'Place a product on styled backgrounds with warm, editorial lighting.',
    tags: ['Image generation', 'Marketing'],
    preview: ['imageInput', 'imageInput', 'imageGeneration'],
    build: async () => {
      // Sample images are drawn locally, then stored on the server like any upload.
      const up = (s: { dataUrl: string; name: string }) => uploadDataUrl(s.dataUrl, s.name);
      const backgrounds = await Promise.all([0, 1, 2].map((i) => up(sampleBackdrop(i))));
      const bottle = await up(sampleBottle());
      const bg = node('imageInput', 0, 0, { title: 'Background', images: backgrounds });
      const obj = node('imageInput', 0, 300, { title: 'Object', images: [bottle] });
      const g = node(
        'imageGeneration',
        420,
        20,
        gen({
          title: 'Image generation',
          prompt: 'A premium skincare serum bottle on a stone pedestal. Warm natural light, soft shadows, and an editorial feel.',
        }),
      );
      return { name: 'Product photography', nodes: [bg, obj, g], edges: [edge(bg, g, 'references'), edge(obj, g, 'references')] };
    },
  },
  {
    id: 'storyboard',
    name: 'Storyboard starter',
    description: 'Shared style context feeding three scenes you can rerun one at a time.',
    tags: ['Image generation', 'Storyboard'],
    preview: ['prompt', 'imageGeneration', 'imageGeneration', 'imageGeneration'],
    build: async () => {
      const style = node('prompt', 0, 260, {
        title: 'Shared style',
        text: 'Cinematic storyboard frame, muted teal and amber palette, 35mm lens, soft film grain.',
      });
      const scenes = [
        'Scene 1. A lighthouse keeper climbs the spiral stairs at dusk, lantern in hand.',
        'Scene 2. From the gallery, she spots a small boat struggling in the storm.',
        'Scene 3. The beam sweeps across the water and finds the boat.',
      ];
      const nodes: AppNode[] = [style];
      const edges: AppEdge[] = [];
      scenes.forEach((text, i) => {
        const g = node('imageGeneration', 440, i * 660 - 560, gen({ title: `Scene ${i + 1}`, prompt: text, aspectRatio: '16:9', model: 'gpt-image-2.5-flare' }));
        nodes.push(g);
        edges.push(edge(style, g, 'prompt'));
      });
      return { name: 'Storyboard', nodes, edges };
    },
  },
  {
    id: 'character',
    name: 'Character exploration',
    description: 'Generate a base mascot, then branch poses from it.',
    tags: ['Mascot creation', 'Branding'],
    preview: ['prompt', 'imageGeneration', 'imageGeneration'],
    build: async () => {
      const desc = node('prompt', 0, 120, {
        title: 'Character',
        text: 'A friendly round robot mascot with big eyes, soft orange shell, flat vector style, white background.',
      });
      const base = node('imageGeneration', 400, 40, gen({ title: 'Base character', aspectRatio: '1:1' }));
      const poses = ['Waving hello', 'Thinking, hand on chin', 'Celebrating, arms up'];
      const nodes: AppNode[] = [desc, base];
      const edges: AppEdge[] = [edge(desc, base, 'prompt')];
      poses.forEach((p, i) => {
        const g = node('imageGeneration', 900, i * 760 - 700, gen({ title: p, prompt: `Same character, ${p.toLowerCase()}.`, aspectRatio: '1:1' }));
        nodes.push(g);
        edges.push(edge(desc, g, 'prompt'), edge(base, g, 'references'));
      });
      return { name: 'Character exploration', nodes, edges };
    },
  },
];
