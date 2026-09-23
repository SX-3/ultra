import type { Serializer } from './serializer';
import { defineSerializer, toBytes } from './serializer';

async function writeAndReadStream(stream: CompressionStream | DecompressionStream, data: Uint8Array) {
  const writer = stream.writable.getWriter();
  // Start writing without awaiting: the write settles only once the reader below
  // drains the readable side. Errors surface through `reader.read()`.
  writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => {});

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }

  // Copy into a single buffer instead of spreading bytes as arguments, which
  // overflows the call stack for large chunks.
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

export function compress(data: Uint8Array, format: CompressionFormat = 'deflate-raw') {
  return writeAndReadStream(new CompressionStream(format), data);
}

export function decompress(data: Uint8Array, format: CompressionFormat = 'deflate-raw') {
  return writeAndReadStream(new DecompressionStream(format), data);
}

export interface CompressedSerializerOptions {
  /** Minimum payload size in bytes to compress. Smaller payloads are sent as-is. @default 1024 */
  threshold?: number;
  /** Compression format passed to the Compression Streams API. @default 'deflate-raw' */
  format?: CompressionFormat;
}

const UNCOMPRESSED = 0;
const COMPRESSED = 1;

function frame(flag: number, data: Uint8Array): Uint8Array {
  const framed = new Uint8Array(data.byteLength + 1);
  framed[0] = flag;
  framed.set(data, 1);
  return framed;
}

/**
 * Wrap a serializer with transparent compression.
 *
 * Compression is a payload-codec concern, not a transport concern, so it is
 * composed around a serializer instead of being hardcoded into HTTP/WebSocket
 * transports. Configure the returned serializer on both the server and the
 * clients.
 *
 * Framing rules keep the decorator transport-agnostic: every payload is sent as
 * bytes prefixed with a one-byte flag that tells the peer whether the rest is
 * compressed. This works for both WebSocket frames and HTTP bodies (which are
 * always read back as bytes).
 */
export function createCompressedSerializer(
  serializer: Serializer,
  options: CompressedSerializerOptions = {},
): Serializer {
  const { threshold = 1024, format = 'deflate-raw' } = options;

  return defineSerializer({
    contentType: serializer.contentType,
    binary: true,

    async serialize(value) {
      const data = await serializer.serialize(value);
      if (data === undefined) return undefined;

      const bytes = toBytes(data);
      return bytes.byteLength < threshold
        ? frame(UNCOMPRESSED, bytes)
        : frame(COMPRESSED, await compress(bytes, format));
    },

    async deserialize(data) {
      const bytes = toBytes(data);
      const payload = bytes.subarray(1);
      return bytes[0] === COMPRESSED
        ? serializer.deserialize(await decompress(payload, format))
        : serializer.deserialize(payload);
    },
  });
}
