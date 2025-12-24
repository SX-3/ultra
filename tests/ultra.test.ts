import type { BaseContext } from '../src/context';
import type { Middleware } from '../src/middleware';
import type { ProcedureHandler } from '../src/procedure';
import type { InputFactory } from '../src/ultra';
import { expect, expectTypeOf, it, mock } from 'bun:test';
import { isWS } from '../src/context';
import { Ultra } from '../src/ultra';
import { start } from './utils';

it.concurrent('deduplication', async () => {
  const requestPayloads: any[] = [];
  const loggerMiddleware = mock<Middleware<any, any, BaseContext>>(async (options) => {
    requestPayloads.push(options.input);
    return options.next();
  });
  const authDeriveFunction = mock<Middleware<any, any, BaseContext>>(() => ({ auth: true }));
  const onServerStartedHandler = mock(() => {});
  const usersArray = ['user1', 'user2', 'user3'] as const;
  const usersListHandler = mock<ProcedureHandler<any, typeof usersArray, any>>(() => usersArray);
  const usersRoutesInitializer = mock((input: InputFactory<BaseContext>) => ({
    users: {
      list: input().http().handler(usersListHandler),
    },
  }));

  const users = new Ultra()
    .use(loggerMiddleware)
    .derive(authDeriveFunction)
    .routes(usersRoutesInitializer)
    .on('server:started', onServerStartedHandler);

  const app = new Ultra()
    .use(loggerMiddleware)
    .derive(authDeriveFunction)
    .use(users)
    .on('server:started', onServerStartedHandler);

  const { http, stop, ws, isReady } = start(app);

  expect(await http.users.list()).toEqual(usersArray);

  expect(usersListHandler, 'handler called more than once').toHaveBeenCalledTimes(1);
  expect(authDeriveFunction, 'derive called more than once').toHaveBeenCalledTimes(1);
  expect(loggerMiddleware, 'middleware called more than once').toHaveBeenCalledTimes(1);
  expect(usersRoutesInitializer, 'initializer called more than once').toHaveBeenCalledTimes(1);
  expect(onServerStartedHandler, 'server started handler called more than once').toHaveBeenCalledTimes(1);

  await isReady;

  expect(await ws.users.list(), 'ws transport failed').toEqual(usersArray);

  expect(usersListHandler, 'handler called more than twice (ws)').toHaveBeenCalledTimes(2);
  expect(authDeriveFunction, 'derive called more than twice (ws)').toHaveBeenCalledTimes(2);
  expect(loggerMiddleware, 'middleware called more than twice (ws)').toHaveBeenCalledTimes(2);
  expect(usersRoutesInitializer, 'initializer called more than twice (ws)').toHaveBeenCalledTimes(1);
  expect(onServerStartedHandler, 'server started handler called more than twice (ws)').toHaveBeenCalledTimes(1);

  await stop();
});

it.concurrent('throws on procedure path conflicts', () => {
  const service = new Ultra()
    .routes(input => ({ ping: input().handler(() => 'pong') }))
    .routes(input => ({ ping: input().handler(() => 'pong') }));

  expect(() => service.start()).toThrowError('Procedure "ping" already exists');
});

it.concurrent('runs global middlewares in registration order', async () => {
  let calls: string[] = [];

  const mw = (name: string) => (options: any) => {
    calls.push(name);
    return options.next();
  };

  const mw2 = mw('mw2');
  const service = new Ultra()
    .use(mw('mw1'))
    .use(mw2)
    .use(mw2)
    .use(mw2)
    .routes(input => ({
      ping: input().http().use(mw('mw4')).handler(() => {
        calls.push('handler');
        return 'pong';
      }),
    }))
    .use(mw('mw3'));

  const { http, stop, ws, isReady } = start(service);

  expect(await http.ping()).toBe('pong');
  expect(calls).toEqual(['mw1', 'mw2', 'mw3', 'mw4', 'handler']);

  calls = [];

  await isReady;

  expect(await ws.ping(), 'ws transport failed').toBe('pong');
  expect(calls).toEqual(['mw1', 'mw2', 'mw3', 'mw4', 'handler']);

  await stop();
});

it.concurrent('enriches context with derived values', async () => {
  const module = new Ultra()
    .derive({ module: 'from-module' });

  const service = new Ultra()
    .derive({ static: 'from-object' })
    .derive(() => ({ dynamic: 'derived' }))
    .deriveUpgrade(() => ({ data: { session: 'id' } }))
    .deriveUpgrade(() => ({ data: { another: 'value' }, headers: { 'x-custom-header': 'custom' } }))
    .use(module)
    .routes(input => ({
      ping: input().http().handler(({ context }) => {
        if (isWS(context)) {
          expectTypeOf(context.ws.data).toMatchObjectType<{ session: string; another: string }>();
          expect(context.ws.data).toMatchObject({ session: 'id', another: 'value' });
        }

        expectTypeOf(context).toExtend<{
          static: string;
          dynamic: string;
          module: string;
        }>();

        expect(context).toMatchObject({
          static: 'from-object',
          dynamic: 'derived',
          module: 'from-module',
        });

        return 'pong';
      }),
    }));

  const { http, stop, ws, isReady } = start(service);

  expect(await http.ping()).toBe('pong');

  await isReady;

  expect(await ws.ping(), 'ws transport failed').toBe('pong');

  await stop();
});
