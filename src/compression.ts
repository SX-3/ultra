// ? EXPERIMENTAL: Think use bun native functions

async function writeAndReadStream(stream: CompressionStream | DecompressionStream, data: BufferSource) {
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks: number[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(...value);
  }

  return new Uint8Array(chunks);
}

export function compress(data: BufferSource, format: CompressionFormat = 'deflate-raw') {
  return writeAndReadStream(new CompressionStream(format), data);
}

export function decompress(data: BufferSource, format: CompressionFormat = 'deflate-raw') {
  return writeAndReadStream(new DecompressionStream(format), data);
}
