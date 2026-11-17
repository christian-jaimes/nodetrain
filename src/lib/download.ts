import type { AppNode, ImageAsset } from '../../shared/graph/types';
import { selectedOutput } from '../../shared/graph/validate';

export type DownloadItem = { name: string; asset: ImageAsset };

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Safe for Windows, macOS and Linux file names. */
export function safeName(s: string, fallback = 'image') {
  const out = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
  return out || fallback;
}

/**
 * The images a selection hands over: one per Image Generation node (the picked output, else the newest) and every
 * image of an Image Input node. File names start with the node name.
 */
export function imagesToDownload(nodes: AppNode[]): DownloadItem[] {
  const items: DownloadItem[] = [];
  for (const n of nodes) {
    const title = safeName(n.data.title, n.type === 'imageInput' ? 'Image input' : 'Image generation');
    let assets: ImageAsset[] = [];
    if (n.type === 'imageGeneration') {
      const pick = selectedOutput(n) ?? n.data.outputs[0];
      if (pick) assets = [pick];
    } else if (n.type === 'imageInput') assets = n.data.images;
    assets.forEach((asset, i) => {
      const suffix = assets.length > 1 ? ` ${i + 1}` : '';
      const ext = (asset.mime && MIME_EXT[asset.mime]) || asset.name.match(/\.(\w{2,5})$/)?.[1]?.toLowerCase() || 'png';
      items.push({ name: `${title}${suffix}.${ext}`, asset });
    });
  }
  return items;
}

/** Makes names unique within one archive ("a.png", "a (2).png"). */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}

let crcTable: Uint32Array | undefined;
function crc32(data: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with no compression. Images are already compressed, so storing them keeps this small and dependency free. */
export function buildZip(files: { name: string; data: Uint8Array }[], date = new Date()): Blob {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

function save(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Downloads one image as is, or several as a zip. Returns how many images were saved. */
export async function downloadImages(items: DownloadItem[], zipName = 'nodetrain-images'): Promise<number> {
  if (!items.length) return 0;
  const names = uniqueNames(items.map((i) => i.name));
  const files = await Promise.all(
    items.map(async (it, i) => {
      const res = await fetch(it.asset.src);
      if (!res.ok) throw new Error(`Could not load ${names[i]}.`);
      return { name: names[i], data: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
  if (files.length === 1) save(new Blob([files[0].data as BlobPart], { type: items[0].asset.mime ?? 'application/octet-stream' }), files[0].name);
  else save(buildZip(files), `${safeName(zipName, 'nodetrain-images')}.zip`);
  return files.length;
}
