import { describe, expect, it } from 'vitest';
import { buildZip, safeName, uniqueNames } from '../src/lib/download';

describe('download helpers', () => {
  it('cleans file names', () => {
    expect(safeName('a/b:c?')).toBe('a-b-c-');
    expect(safeName('   ')).toBe('image');
  });
  it('makes names unique', () => {
    expect(uniqueNames(['a.png', 'A.png', 'b.png'])).toEqual(['a.png', 'A (2).png', 'b.png']);
  });
  it('builds a valid stored zip', async () => {
    const blob = buildZip([{ name: 'x.txt', data: new TextEncoder().encode('hello') }]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const v = new DataView(buf.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(0x3610a686); // crc32("hello")
    expect(v.getUint32(buf.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(buf.length - 14, true)).toBe(1);
  });
});
