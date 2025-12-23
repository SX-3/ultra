import type { Ultra } from '../src/ultra';
import type { Result, StandardSchemaV1 } from '../src/validation';
import { afterAll } from 'bun:test';
import { createHTTPClient, createWebSocketClient } from '../src/client';

let portCounter = 3000;
const apps = new Set<Ultra>();
const sockets = new Set<WebSocket>();

afterAll(async () => {
  sockets.forEach(socket => socket.close());
  await Promise.all(
    Array.from(apps).map(app => app.stop(true)),
  );
  sockets.clear();
  apps.clear();
});

export function makeSchema<O>(validateFn: (input: unknown) => Result<O>): StandardSchemaV1<O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'unit-test',
      validate: validateFn,
    },
  };
}

export function start<T extends Ultra<any, any, any>>(app: T, port = portCounter++) {
  apps.add(app);
  const instance = app.start({ port });
  const { promise, resolve } = Promise.withResolvers();
  const socket = new WebSocket(`ws://localhost:${port}/ws`);
  socket.addEventListener('open', resolve);
  sockets.add(socket);
  return {
    url: instance.url.toString(),
    port,
    http: createHTTPClient<T>({
      baseUrl: `http://localhost:${port}`,
    }),
    ws: createWebSocketClient<T>({
      socket: () => socket,
    }),
    stop: () => {
      socket.close();
      instance.stop(true);
      apps.delete(app);
      sockets.delete(socket);
    },
    isReady: promise,
  };
}
