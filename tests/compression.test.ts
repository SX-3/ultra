import { gunzipSync, inflateSync } from 'bun';
import { expect, it } from 'bun:test';
import { compress, createCompressedSerializer, decompress } from '../src/compression';
import { jsonSerializer } from '../src/serializer';

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

it('compressed serializer round-trips small and large payloads', async () => {
  const serializer = createCompressedSerializer(jsonSerializer, { threshold: 64 });

  const small = { a: 1 };
  const smallEncoded = await serializer.serialize(small);
  expect(smallEncoded).toBeInstanceOf(Uint8Array);
  expect(smallEncoded![0]).toBe(0);
  expect(await serializer.deserialize(smallEncoded!)).toEqual(small);

  const large = { items: Array.from({ length: 100 }, (_, i) => `item-${i}`) };
  const largeEncoded = await serializer.serialize(large);
  expect(largeEncoded).toBeInstanceOf(Uint8Array);
  expect(largeEncoded![0]).toBe(1);
  expect(await serializer.deserialize(largeEncoded!)).toEqual(large);
});

it('round-trips large incompressible payloads without overflowing the stack', async () => {
  const size = 16 * 1024 * 1024;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 256) | 0;

  const compressed = await compress(data, 'deflate-raw');
  const decompressed = await decompress(compressed, 'deflate-raw');

  expect(decompressed.byteLength).toBe(size);
  expect(decompressed).toEqual(data);
});
