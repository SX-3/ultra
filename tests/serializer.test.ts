import type { Serializer } from '../src/serializer';
import { describe, expect, it } from 'bun:test';
import { createHTTPClient, createWebSocketClient } from '../src/client';
import { createCompressedSerializer } from '../src/compression';
import { createCORSMiddleware } from '../src/cors';
import { toHTTPResponse, toRPCResponse } from '../src/response';
import { defineSerializer, jsonSerializer, toBytes, toText } from '../src/serializer';
import { Ultra } from '../src/ultra';
import { start } from './utils';

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? { $type: 'bigint', value: value.toString() } : value;
}

function bigintReviver(_key: string, value: any) {
  if (value && typeof value === 'object' && value.$type === 'bigint' && typeof value.value === 'string') {
    return BigInt(value.value);
  }
  return value;
}

/** Text codec that encodes `bigint` with JSON. */
const bigintSerializer = defineSerializer({
  contentType: 'application/json',
  serialize: value => JSON.stringify(value, bigintReplacer),
  deserialize: data => JSON.parse(toText(data), bigintReviver),
});

/** Binary codec that frames a JSON payload with a 4-byte length prefix. */
const binarySerializer = defineSerializer({
  contentType: 'application/octet-stream',
  binary: true,
  serialize(value) {
    const payload = new TextEncoder().encode(JSON.stringify(value, bigintReplacer));
    const framed = new Uint8Array(payload.byteLength + 4);
    new DataView(framed.buffer).setUint32(0, payload.byteLength);
    framed.set(payload, 4);
    return framed;
  },
  deserialize(data) {
    const bytes = toBytes(data);
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)), bigintReviver);
  },
});

async function connect<T extends Ultra<any, any, any>>(wsUrl: string, serializer: Serializer) {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>(resolve => socket.addEventListener('open', () => resolve(), { once: true }));

  return {
    socket,
    client: createWebSocketClient<T>({ socket: () => socket, serializer }),
  };
}

describe('jsonSerializer', () => {
  it('round-trips JSON values', async () => {
    const value = { a: 1, b: [true, null], c: 'text' };

    const encoded = await jsonSerializer.serialize(value);
    expect(await jsonSerializer.deserialize(encoded!)).toEqual(value);
  });

  it('advertises application/json', () => {
    expect(jsonSerializer.contentType).toBe('application/json');
  });

  it('cannot serialize bigint', () => {
    expect(() => jsonSerializer.serialize({ value: 1n })).toThrow();
  });
});

describe('defineSerializer', () => {
  it('returns the same serializer instance', () => {
    expect(defineSerializer(bigintSerializer)).toBe(bigintSerializer);
  });
});

describe('serializer-aware response helpers', () => {
  it('toRPCResponse uses the provided serializer', async () => {
    const encoded = await toRPCResponse('1', { value: 7n }, bigintSerializer);

    expect(encoded).toContain('"$type":"bigint"');
    expect(await bigintSerializer.deserialize(encoded)).toEqual({ id: '1', result: { value: 7n } });
  });

  it('toHTTPResponse uses the provided serializer', async () => {
    const response = await toHTTPResponse({ value: 7n }, bigintSerializer);

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await bigintSerializer.deserialize(await response.text())).toEqual({ value: 7n });
  });

  it('toHTTPResponse defaults to JSON', async () => {
    const response = await toHTTPResponse({ ok: true });

    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('text serializer transport', () => {
  const app = new Ultra({ serializer: bigintSerializer }).routes(input => ({
    echo: input<{ value: bigint }>().http().handler(({ input }) => input.value),
    add: input<{ a: bigint; b: bigint }>().http().handler(({ input }) => input.a + input.b),
    nested: input().http().handler(() => ({ id: 1n, items: [2n, 3n] })),
  }));

  const { port, wsUrl } = start(app);

  it('sends and receives bigint over HTTP', async () => {
    const http = createHTTPClient<typeof app>({
      baseUrl: `http://localhost:${port}`,
      serializer: bigintSerializer,
    });

    expect(await http.echo({ value: 123n })).toBe(123n);
    expect(await http.add({ a: 1n, b: 2n })).toBe(3n);
    expect(await http.nested()).toEqual({ id: 1n, items: [2n, 3n] });
  });

  it('sends and receives bigint over WebSocket', async () => {
    const { socket, client } = await connect<typeof app>(wsUrl, bigintSerializer);

    expect(await client.echo({ value: 456n })).toBe(456n);
    expect(await client.nested()).toEqual({ id: 1n, items: [2n, 3n] });

    socket.close();
  });

  it('requires the client to use the same serializer', async () => {
    const http = createHTTPClient<typeof app>({ baseUrl: `http://localhost:${port}` });

    const result = await http.nested() as unknown;
    expect(result).toEqual({
      id: { $type: 'bigint', value: '1' },
      items: [
        { $type: 'bigint', value: '2' },
        { $type: 'bigint', value: '3' },
      ],
    });
  });
});

describe('binary serializer transport', () => {
  const app = new Ultra({ serializer: binarySerializer }).routes(input => ({
    echo: input<{ value: bigint }>().http().handler(({ input }) => input.value),
    nested: input().http().handler(() => ({ id: 1n, items: [2n, 3n] })),
  }));

  const { port, wsUrl } = start(app);

  it('round-trips binary frames over HTTP', async () => {
    const http = createHTTPClient<typeof app>({
      baseUrl: `http://localhost:${port}`,
      serializer: binarySerializer,
    });

    expect(await http.echo({ value: 123n })).toBe(123n);
    expect(await http.nested()).toEqual({ id: 1n, items: [2n, 3n] });
  });

  it('round-trips binary frames over WebSocket', async () => {
    const { socket, client } = await connect<typeof app>(wsUrl, binarySerializer);

    expect(await client.echo({ value: 456n })).toBe(456n);
    expect(await client.nested()).toEqual({ id: 1n, items: [2n, 3n] });

    socket.close();
  });
});

describe('compressed serializer', () => {
  const serializer = createCompressedSerializer(bigintSerializer, { threshold: 256 });
  const app = new Ultra({ serializer }).routes(input => ({
    echo: input<{ value: bigint }>().http().handler(({ input }) => input.value),
    large: input().http().handler(() => ({ items: Array.from({ length: 64 }, (_, i) => BigInt(i)) })),
    largeRequest: input<{ values: bigint[] }>().http().handler(({ input }) => input.values.length),
  }));

  const { port, wsUrl } = start(app);

  const expected = { items: Array.from({ length: 64 }, (_, i) => BigInt(i)) };

  it('round-trips small and large payloads over HTTP', async () => {
    const http = createHTTPClient<typeof app>({
      baseUrl: `http://localhost:${port}`,
      serializer,
    });

    expect(await http.echo({ value: 5n })).toBe(5n);
    expect(await http.large()).toEqual(expected);
  });

  it('round-trips small and large payloads over WebSocket', async () => {
    const { socket, client } = await connect<typeof app>(wsUrl, serializer);

    expect(await client.echo({ value: 7n })).toBe(7n);
    expect(await client.large()).toEqual(expected);
    expect(await client.largeRequest({ values: Array.from({ length: 64 }, (_, i) => BigInt(i)) })).toBe(64);

    socket.close();
  });
});

describe('module serializer propagation', () => {
  it('adopts the serializer of a merged module', async () => {
    const module = new Ultra({ serializer: bigintSerializer }).routes(input => ({
      value: input().http().handler(() => 42n),
    }));

    const host = new Ultra().use(module);
    const { url } = start(host);

    const response = await fetch(`${url}value`);
    expect(await response.json()).toEqual({ $type: 'bigint', value: '42' });
  });

  it('keeps an explicitly configured host serializer', async () => {
    const markerSerializer = defineSerializer({
      contentType: 'application/x-marker',
      serialize: value => JSON.stringify(value),
      deserialize: data => JSON.parse(toText(data)),
    });

    const module = new Ultra({ serializer: markerSerializer }).routes(input => ({
      value: input().http().handler(() => ({ ok: true })),
    }));

    const host = new Ultra({ serializer: jsonSerializer }).use(module);
    const { url } = start(host);

    const response = await fetch(`${url}value`);
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('CORS with a custom serializer', () => {
  const ORIGIN = 'http://allowed.com';
  const app = new Ultra({ serializer: bigintSerializer })
    .use(createCORSMiddleware({ origin: [ORIGIN] }))
    .routes(input => ({
      ping: input().http().handler(() => ({ pong: 1n })),
    }));

  const { url } = start(app);

  it('decorates the encoded response through the single boundary', async () => {
    const response = await fetch(`${url}ping`, { headers: { Origin: ORIGIN } });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await bigintSerializer.deserialize(await response.text())).toEqual({ pong: 1n });
  });
});
