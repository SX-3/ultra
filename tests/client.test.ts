import { describe, expect, expectTypeOf, it } from 'bun:test';
import { createSuperClient, createWebSocketClient } from '../src/client';
import { Ultra } from '../src/ultra';
import { makeSchema, start } from './utils';

const number = makeSchema<number>(() => ({ value: 42 }));
const string = makeSchema<string>(() => ({ value: 'hello' }));

const app = new Ultra().routes(input => ({
  hello: input().http().handler(() => 'Hello World!' as const),
  echo: input<string>().http().handler(({ input }) => input),
  validated: input(string).http().output(number).handler(() => 42),
}));

describe('clients', async () => {
  const { ws, http, isReady, wsUrl } = start(app);

  let isHTTP = false;
  const client = createSuperClient<typeof app>({
    pick: () => isHTTP ? http : ws,
  });

  await isReady;

  it('HTTP requests and types', async () => {
    expectTypeOf(http.hello).toBeFunction();
    expectTypeOf(http.hello).returns.resolves.toEqualTypeOf<'Hello World!'>();

    expectTypeOf(http.echo).toBeFunction();
    expectTypeOf(http.echo).returns.resolves.toEqualTypeOf<string>();
    expectTypeOf(http.echo).toBeCallableWith('test');

    expectTypeOf(http.validated).toBeFunction();
    expectTypeOf(http.validated).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(http.validated).toBeCallableWith('some string');

    const [hello, echo] = await Promise.all([
      http.hello(),
      http.echo('test'),
    ]);

    expect(hello).toBe('Hello World!');
    expect(echo).toBe('test');

    expectTypeOf(hello).toBeString();
    expectTypeOf(hello).toEqualTypeOf<'Hello World!'>();
    expectTypeOf(echo).toBeString();
    expectTypeOf(echo).toEqualTypeOf<string>();
  });

  it('WebSocket requests and types', async () => {
    expectTypeOf(ws.hello).toBeFunction();
    expectTypeOf(ws.hello).returns.resolves.toEqualTypeOf<'Hello World!'>();

    expectTypeOf(ws.echo).toBeFunction();
    expectTypeOf(ws.echo).returns.resolves.toEqualTypeOf<string>();
    expectTypeOf(ws.echo).toBeCallableWith('test');
    expectTypeOf(ws.validated).toBeFunction();
    expectTypeOf(ws.validated).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(ws.validated).toBeCallableWith('some string');

    const [hello, echo] = await Promise.all([
      ws.hello(),
      ws.echo('test'),
    ]);

    expect(hello).toBe('Hello World!');
    expect(echo).toBe('test');

    expectTypeOf(hello).toBeString();
    expectTypeOf(hello).toEqualTypeOf<'Hello World!'>();
    expectTypeOf(echo).toBeString();
    expectTypeOf(echo).toEqualTypeOf<string>();
  });

  it('super requests and types', async () => {
    expectTypeOf(client.hello).toBeFunction();
    expectTypeOf(client.hello).returns.resolves.toEqualTypeOf<'Hello World!'>();

    expectTypeOf(client.echo).toBeFunction();
    expectTypeOf(client.echo).returns.resolves.toEqualTypeOf<string>();
    expectTypeOf(client.echo).toBeCallableWith('test');

    expectTypeOf(client.validated).toBeFunction();
    expectTypeOf(client.validated).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(client.validated).toBeCallableWith('some string');

    const hello = await client.hello();
    isHTTP = true;
    const echo = await client.echo('test');

    expect(hello).toBe('Hello World!');
    expect(echo).toBe('test');

    expectTypeOf(hello).toBeString();
    expectTypeOf(hello).toEqualTypeOf<'Hello World!'>();
    expectTypeOf(echo).toBeString();
    expectTypeOf(echo).toEqualTypeOf<string>();
  });

  describe('batching', async () => {
    const socket = new WebSocket(wsUrl);
    const { promise, resolve } = Promise.withResolvers();
    socket.onopen = resolve;
    await promise;

    it('default', async () => {
      const client = createWebSocketClient<typeof app>({
        socket: () => socket,
        onBeforeSend(data) {
          if (typeof data !== 'string') return;
          data = JSON.parse(data);
          expect(data).toBeArray();
          expect(data).toHaveLength(3);
        },
      });

      const promises: Promise<any>[] = [];

      promises.push(client.echo('One'));
      promises.push(client.hello());
      promises.push(client.echo('Three'));

      const result = await Promise.all(promises);

      expect(result).toEqual(['One', 'Hello World!', 'Three']);
    });

    it('compression', async () => {
      const client = createWebSocketClient<typeof app>({
        socket: () => socket,
        compression: 100,
        onBeforeSend(data) {
          expect(data).not.toBeString();
        },
      });

      const promises: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        promises.push(client.hello());
      }

      await Promise.all(promises);
    });
  });
});
