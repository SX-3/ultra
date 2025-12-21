import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { Ultra } from '../src/ultra';

const userListHandler = mock(() => ['user1', 'user2'] as const);
const userRoutesInitializer = mock(input => ({
  users: {
    list: input().http().handler(userListHandler),
  },
} as const));
const onServerStartedHandler = mock(() => {});
const deriveFunction = mock(() => ({
  derived: 'eeee',
}));
const middlewareFunction = mock(({ next }) => next());

const users = new Ultra()
  .routes(userRoutesInitializer)
  .derive(deriveFunction)
  .use(middlewareFunction)
  .on('server:started', onServerStartedHandler);

const module1 = new Ultra()
  .derive(deriveFunction)
  .use(middlewareFunction)
  .use(users);
const module2 = new Ultra()
  .use(users)
  .use(module1);

const app = new Ultra()
  .use(users)
  .derive(deriveFunction)
  .use(middlewareFunction)
  .use(module1)
  .use(module2);

beforeAll(async () => app.start());
afterAll(async () => await app.stop(true));

describe('deduplication', () => {
  it('initializers', () => {
    expect(userRoutesInitializer).toHaveBeenCalledTimes(1);
  });

  it('handlers & derive & middleware', async () => {
    const res = await fetch('http://localhost:3000/users/list');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(['user1', 'user2']);
    expect(userListHandler).toHaveBeenCalledTimes(1);
    expect(deriveFunction).toHaveBeenCalledTimes(1);
    expect(middlewareFunction).toHaveBeenCalledTimes(1);
    expect(userRoutesInitializer).toHaveBeenCalledTimes(1);
  });

  it('events', () => {
    expect(onServerStartedHandler).toHaveBeenCalledTimes(1);
  });
});

// TODO: rewrite AI trash
describe('other', () => {
  it('throws on procedure path conflicts', () => {
    const conflictApp = new Ultra()
      .routes(input => ({
        foo: input().handler(() => 'first'),
      }))
      .routes(input => ({
        foo: input().handler(() => 'second'),
      }));

    expect(() => (conflictApp as any).buildProcedures()).toThrow('Procedure conflict at path "foo"');
  });

  it('runs global middlewares in registration order', async () => {
    const calls: string[] = [];
    const service = new Ultra()
      .use(({ next }) => {
        calls.push('mw1');
        return next();
      })
      .use(({ next }) => {
        calls.push('mw2');
        return next();
      })
      .routes(input => ({
        ping: input().handler(({ input }) => {
          calls.push(`handler:${input}`);
          return `pong-${input}`;
        }),
      }));

    (service as any).buildProcedures();
    const handler = (service as any).handlers.get('ping');

    expect(handler).toBeDefined();
    const result = await handler!({ input: 'abc', context: { server: {} as any, request: {} as any } });

    expect(result).toBe('pong-abc');
    expect(calls).toEqual(['mw1', 'mw2', 'handler:abc']);
  });

  it('enriches context with derived values', async () => {
    const server = {} as any;
    const request = {} as any;

    const service = new Ultra()
      .derive({ static: 'from-object' })
      .derive((ctx: any) => ({ dynamic: ctx.request === request ? 'derived' : 'missing' }));

    const context = await (service as any).enrichContext({ server, request });

    expect(context).toMatchObject({
      server,
      request,
      static: 'from-object',
      dynamic: 'derived',
    });
  });

  it('returns RPC errors for missing handlers and emits on failures', async () => {
    const send404 = mock(() => {});
    const ws404 = { send: send404 } as any;

    const service = new Ultra();
    (service as any).server = {} as any;

    await (service as any).handleRPC(ws404, { id: '1', method: 'unknown' });
    expect(send404).toHaveBeenCalledWith('{"id": "1", "error": {"code": 404, "message": "Not found"}}');

    const errors: Error[] = [];
    const send500 = mock(() => {});
    const ws500 = { send: send500 } as any;

    service.on('error', (err) => {
      errors.push(err as Error);
    });
    (service as any).handlers.set('fail', () => {
      throw new Error('boom');
    });

    await (service as any).handleRPC(ws500, { id: '2', method: 'fail' });
    expect(errors.map(err => err.message)).toEqual(['boom']);
    expect(send500).toHaveBeenCalledWith('{"id":"2","error":{"code":500,"message":"boom"}}');
  });
});
