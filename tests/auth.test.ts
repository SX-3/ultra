import type { SessionContext } from '../src/session';
import { describe, expect, expectTypeOf, it } from 'bun:test';
import { Auth, createAuthModule, defineConfig, isAuthenticated, SessionAuthProvider } from '../src/auth';
import { createSessionModule, defineConfig as defineSessionConfig, MemorySessionStore } from '../src/session';

import { Ultra } from '../src/ultra';
import { start } from './utils';

interface User {
  id: string;
  name: string;
}

const config = defineConfig<User>({
  provider: 'session',
  providers: {
    session: context => new SessionAuthProvider(context as SessionContext),
  },
});

const sessionConfig = defineSessionConfig({
  name: 'session',
  ttlSec: 100,
  secret: '213123',
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
  .use(createSessionModule(sessionConfig))
  .use(createAuthModule<User>(config))
  .routes(input => ({
    ping: input().http().handler(({ context }) => {
      expectTypeOf(context.auth).toExtend<Auth<any, any>>();
      expect(context.auth).toBeInstanceOf(Auth);
      return 'pong';
    }),

    me: input().use(isAuthenticated).http().handler(({ context }) => context.auth.user!),

    login: input<{ id: string; name: string }>().http().handler(async ({ input, context }) => {
      await context.auth.login({ id: input.id, name: input.name });
      return input;
    }),
  }));

describe.concurrent('auth', async () => {
  const { http, ws, isReady, url } = start(app);
  await isReady;

  it('should have auth in context', async () => {
    expect(await http.ping()).toBe('pong');
    expect(await ws.ping()).toBe('pong');
  });

  it('should protect route with isAuthenticated middleware', async () => {
    await expect(http.me()).rejects.toThrowError();
    await expect(ws.me()).rejects.toThrowError();
  });

  it('should login user and access protected route', async () => {
    const userInfo = { id: '1', name: 'John Doe' };
    const response = await fetch(`${url}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userInfo),
      credentials: 'include',
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(userInfo);

    const cookie = response.headers.get('set-cookie');
    expect(cookie).toBeDefined();
    expect(cookie).toContain('session=');

    const meResponse = await fetch(`${url}/me`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie!,
      },
    });

    expect(meResponse.ok).toBe(true);
    expect(await meResponse.json()).toEqual(userInfo);
  });
});
