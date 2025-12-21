import { describe, expectTypeOf, it } from 'bun:test';
import { createHTTPClient, createSuperClient, createWebSocketClient } from '../src/client';
import { Ultra } from '../src/ultra';

const _service = new Ultra().routes(input => ({
  ping: input<string>().handler(() => 'pong'),
  optional: input<undefined>().handler(() => 'optional'),
  user: {
    get: input<{ id: string }>().handler(({ input }) => ({ name: `user-${input.id}` })),
  },
}));

const client = createHTTPClient<typeof _service>({ baseUrl: 'http://example.test' });
const wsClient = createWebSocketClient<typeof _service>({
  socket: () => ({
    addEventListener() {},
    removeEventListener() {},
    send() {},
  } as unknown as WebSocket),
});

const sc = createSuperClient<typeof _service>({
  pick: (method) => {
    return method.startsWith('user/') ? wsClient : client;
  },
});

describe('createHTTPClient types', () => {
  it('infers inputs and outputs for procedures', () => {
    expectTypeOf(client.ping).toBeCallableWith('abc');
    expectTypeOf(client.ping).returns.resolves.toEqualTypeOf<string>();

    expectTypeOf(client.user.get).toBeCallableWith({ id: '42' });
    // expectTypeOf(client.user.get).returns.resolves.toEqualTypeOf<{ name: string }>(); //Bug?
  });

  it('treats undefined inputs as optional parameters', () => {
    expectTypeOf(client.optional).toBeCallableWith();
    expectTypeOf(client.optional).toBeCallableWith(undefined);
    expectTypeOf(client.optional).returns.resolves.toEqualTypeOf<string>();
  });

  it('passes call options through to invocation', () => {
    expectTypeOf(client.ping).toBeCallableWith('abc', {
      timeout: 10,
      baseUrl: 'http://override.test',
      method: 'GET',
    });
  });
});

describe('createWebSocketClient types', () => {
  it('infers inputs and outputs for procedures', () => {
    expectTypeOf(wsClient.ping).toBeCallableWith('abc');
    expectTypeOf(wsClient.ping).returns.resolves.toEqualTypeOf<string>();

    expectTypeOf(wsClient.user.get).toBeCallableWith({ id: '42' });
  });

  it('treats undefined inputs as optional parameters', () => {
    expectTypeOf(wsClient.optional).toBeCallableWith();
    expectTypeOf(wsClient.optional).toBeCallableWith(undefined);
    expectTypeOf(wsClient.optional).returns.resolves.toEqualTypeOf<string>();
  });

  it('passes call options through to invocation', () => {
    expectTypeOf(wsClient.ping).toBeCallableWith('abc', { timeout: 5 });
  });
});

describe('createSuperClient types', () => {
  it('infers inputs and outputs for procedures', () => {
    expectTypeOf(sc.ping).toBeCallableWith('abc');
    expectTypeOf(sc.ping).returns.resolves.toEqualTypeOf<string>();

    expectTypeOf(sc.user.get).toBeCallableWith({ id: '42' });
  });

  it('accepts callOptions from either HTTP or WebSocket clients', () => {
    expectTypeOf(sc.ping).toBeCallableWith('abc', { timeout: 10 });
    expectTypeOf(sc.ping).toBeCallableWith('abc', {
      baseUrl: 'http://override.test',
      method: 'GET',
    });
    expectTypeOf(sc.ping).toBeCallableWith('abc', {
      socket: () => ({} as unknown as WebSocket),
    });
  });
});
