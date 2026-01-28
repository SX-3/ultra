import { gunzipSync, inflateSync } from 'bun';
import { expect, it } from 'bun:test';
import { compress, decompress } from '../src/compression';

const text = new TextEncoder().encode('Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum.');

it('should compress and decompress data correctly', async () => {
  const ALGO: CompressionFormat = 'deflate';
  const compressed = await compress(text, ALGO);
  const decompressed = await decompress(compressed, ALGO);

  expect(decompressed).toEqual(text);
  expect(text.byteLength).toBeGreaterThan(compressed.byteLength);
});

it('bun able decompress gzip', async () => {
  const compressed = await compress(text, 'gzip');
  expect(gunzipSync(compressed)).toEqual(text);
});

it('bun able decompress deflate', async () => {
  const compressed = await compress(text, 'deflate-raw');
  expect(inflateSync(compressed)).toEqual(text);
});
