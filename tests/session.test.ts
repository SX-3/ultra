import { describe, expect, expectTypeOf, it } from 'bun:test';
import { createSessionModule, defineConfig, MemorySessionStore, Session } from '../src/session';

import { Ultra } from '../src/ultra';
import { start } from './utils';

const config = defineConfig({
  secret: 'my-secret',
  name: 'session',
  ttlSec: 100,
  store: 'memory',
  cookie: {
    // ! Test only
    httpOnly: false,
  },
  stores: {
    memory: config => new MemorySessionStore(config),
  },
});

const app = new Ultra()
  .use(createSessionModule(config))
  .routes(input => ({
    ping: input().http().handler(({ context }) => {
      expectTypeOf(context.session).toExtend<Session<any>>();
      expect(context.session).toBeInstanceOf(Session);
      return 'pong';
    }),

    set: input<{ key: string; value: string }>().http().handler(async ({ input, context }) => {
      await context.session.set(input.key, input.value);
      return input;
    }),

    get: input<{ key: string }>().http().handler(async ({ input, context }) => {
      const value = await context.session.get(input.key);
      return value || 404;
    }),
  }));

describe('session', () => {
  const { url } = start(app);
  it('should create session and respond session cookie', async () => {
    const response = await fetch(`${url}/ping`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('pong');

    const cookie = response.headers.get('set-cookie');
    expect(cookie).toBeDefined();

    expect(cookie).toContain('session=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('should set and get session value', async () => {
    const setResponse = await fetch(`${url}/set`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'foo', value: 'bar' }),
    });

    expect(setResponse.status).toBe(200);
    const setData = await setResponse.json();
    expect(setData).toEqual({ key: 'foo', value: 'bar' });

    const cookie = setResponse.headers.get('set-cookie');
    expect(cookie).toBeDefined();
    expect(cookie).toContain('session=');

    const getResponse = await fetch(`${url}/get`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Cookie': cookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'foo' }),
    });

    expect(getResponse.status).toBe(200);
    const getData = await getResponse.text();
    expect(getData).toBe('bar');
  });
});
