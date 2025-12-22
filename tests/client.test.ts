import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createHTTPClient, createSuperClient, createWebSocketClient } from '../src/client';

const BASE_URL = 'http://example.test';
const originalFetch = globalThis.fetch;

type FetchImpl = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

function setFetchMock(impl: FetchImpl) {
  const fetchMock = mock(impl);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createHTTPClient', () => {
  it('posts JSON by default and parses JSON responses', async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const client = createHTTPClient({ baseUrl: BASE_URL });
    const result = await (client as any).ping({ foo: 'bar' });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/ping`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('builds GET query strings and merges headers without a body', async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response('ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })));

    const client = createHTTPClient({
      baseUrl: BASE_URL,
      headers: { 'X-Base': 'base' },
    });

    const result = await (client as any).users.list(
      { page: 2, search: 'hi', skip: undefined },
      { method: 'GET', headers: { 'X-Base': 'override', 'X-Extra': '1' } },
    );

    expect(result).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/users/list?page=2&search=hi`);
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Base')).toBe('override');
    expect(headers.get('X-Extra')).toBe('1');
    expect(headers.get('Content-Type')).toBeNull();
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('sends plain text bodies and honors call-specific baseUrl and method', async () => {
    const fetchMock = setFetchMock(() => Promise.resolve(new Response('text ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })));

    const client = createHTTPClient({ baseUrl: BASE_URL, method: 'PATCH' });

    const result = await (client as any).echo('hello', {
      method: 'PUT',
      baseUrl: 'http://override.test',
    });

    expect(result).toBe('text ok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://override.test/echo');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('text/plain');
    expect(init?.body).toBe('hello');
  });

  it('throws on non-OK responses', async () => {
    setFetchMock(() => Promise.resolve(new Response('fail', {
      status: 500,
      statusText: 'Oops',
    })));

    const client = createHTTPClient({ baseUrl: BASE_URL });

    await expect((client as any).fail()).rejects.toThrow('HTTP error: Oops 500 ');
  });

  it('aborts requests when the timeout elapses', async () => {
    const fetchMock = setFetchMock((_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const reason = (init.signal as AbortSignal).reason ?? 'aborted';
        const error = new Error(String(reason));
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const client = createHTTPClient({ baseUrl: BASE_URL });
    const call = (client as any).slow(undefined, { timeout: 5 });

    await expect(call).rejects.toThrow('Timeout: 5');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.signal?.aborted).toBe(true);
  });
});

describe('createWebSocketClient', () => {
  class FakeSocket {
    private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
    sent: string[] = [];

    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    emitMessage(data: unknown) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      const event = { data: payload } as MessageEvent;
      this.listeners.get('message')?.forEach(listener => listener(event));
    }

    send(payload: string) {
      this.sent.push(payload);
    }

    listenerCount(type: string) {
      return this.listeners.get(type)?.size ?? 0;
    }

    get readyState() {
      return WebSocket.OPEN;
    }
  }

  const makeClient = (options?: { timeout?: number }) => {
    const socket = new FakeSocket();
    const client = createWebSocketClient({ socket: () => socket as unknown as WebSocket, ...options });
    return { socket, client };
  };

  it('sends requests and resolves matching responses', async () => {
    const { socket, client } = makeClient();

    const call = (client as any).ping({ foo: 'bar' });
    const payload = JSON.parse(socket.sent.at(-1)!);

    expect(payload.method).toBe('ping');
    expect(payload.params).toEqual({ foo: 'bar' });

    socket.emitMessage({ id: payload.id, result: { ok: true } });

    await expect(call).resolves.toEqual({ ok: true });
    expect(socket.listenerCount('message')).toBe(0);
  });

  it('rejects when the server responds with an error', async () => {
    const { socket, client } = makeClient();
    const call = (client as any).fail('nope');
    const payload = JSON.parse(socket.sent.at(-1)!);

    socket.emitMessage({ id: payload.id, error: 'boom' });

    await expect(call).rejects.toBe('boom');
    expect(socket.listenerCount('message')).toBe(0);
  });

  it('times out when no response arrives', async () => {
    const { client, socket } = makeClient({ timeout: 50 });
    const call = (client as any).slow(undefined, { timeout: 5 });

    await expect(call).rejects.toBe('Timeout: 5');
    expect(socket.listenerCount('message')).toBe(0);
  });

  it('ignores responses with different ids', async () => {
    const { socket, client } = makeClient();
    let settled = false;
    const call = (client as any)
      .echo('hi')
      .finally(() => {
        settled = true;
      });
    const payload = JSON.parse(socket.sent.at(-1)!);

    socket.emitMessage({ id: 'other', result: 'wrong' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    socket.emitMessage({ id: payload.id, result: 'ok' });

    await expect(call).resolves.toBe('ok');
    expect(socket.listenerCount('message')).toBe(0);
  });
});

describe('createSuperClient', () => {
  it('routes calls to the picked client and forwards method/params/callOptions to pick()', async () => {
    const http = {
      ping: mock(async (_input: unknown, _opts?: unknown) => 'http-pong'),
      user: {
        get: mock(async (input: { id: string }, opts?: { timeout?: number }) => ({ via: 'http', id: input.id, timeout: opts?.timeout })),
      },
    };

    const pick = mock((method: string, params: unknown, callOptions?: unknown) => {
      expect(method).toBeTypeOf('string');
      expect(method).toBe('user/get');
      expect(params).toEqual({ id: '42' });
      expect(callOptions).toEqual({ timeout: 123 });
      return http as any;
    });

    const client = createSuperClient<any>({ pick: pick as any });
    const result = await (client as any).user.get({ id: '42' }, { timeout: 123 });

    expect(result).toEqual({ via: 'http', id: '42', timeout: 123 });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(http.user.get).toHaveBeenCalledTimes(1);
  });

  it('can switch between different underlying clients based on method', async () => {
    const http = {
      ping: mock(async () => 'http'),
      user: {
        get: mock(async () => 'http-user'),
      },
    };

    const ws = {
      ping: mock(async () => 'ws'),
      user: {
        get: mock(async () => 'ws-user'),
      },
    };

    const pick = mock((method: string) => {
      return method.startsWith('user/') ? (ws as any) : (http as any);
    });

    const client = createSuperClient<any>({ pick: pick as any });

    await expect((client as any).ping('x')).resolves.toBe('http');
    await expect((client as any).user.get({ id: '1' })).resolves.toBe('ws-user');

    expect(http.ping).toHaveBeenCalledTimes(1);
    expect(ws.user.get).toHaveBeenCalledTimes(1);
  });

  it('throws when calling the client root directly', () => {
    const pick = mock(() => ({}) as any);
    const client = createSuperClient<any>({ pick: pick as any });
    expect(() => (client as any)()).toThrow('Cannot call client root; select a procedure first');
    expect(pick).toHaveBeenCalledTimes(0);
  });
});
