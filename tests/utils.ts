import type { Ultra } from '../src/ultra';
import type { Result, StandardSchemaV1 } from '../src/validation';
import { afterAll } from 'bun:test';
import { createHTTPClient, createWebSocketClient } from '../src/client';

let portCounter = 40000;
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
  const wsUrl = `ws://localhost:${port}/ws`;
  const socket = new WebSocket(wsUrl);
  socket.addEventListener('open', resolve);
  sockets.add(socket);
  return {
    url: instance.url.toString(),
    wsUrl,
    port,
    http: createHTTPClient<T>({
      baseUrl: `http://localhost:${port}`,
    }),
    ws: createWebSocketClient<T>({
      socket: () => socket,
    }),
    stop: () => {
      socket.close();
      apps.delete(app);
      sockets.delete(socket);
      return instance.stop(true);
    },
    isReady: promise,
  };
}
