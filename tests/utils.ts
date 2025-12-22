import type { Ultra } from '../src/ultra';
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

export function start<T extends Ultra<any, any, any>>(app: T, port = portCounter++) {
  apps.add(app);
  const instance = app.start({ port });
  const socket = new WebSocket(`ws://localhost:${port}/ws`);
  sockets.add(socket);
  const { promise, resolve } = Promise.withResolvers();
  socket.addEventListener('open', resolve);
  return {
    port,
    app: instance,
    url: instance.url,
    http: createHTTPClient<T>({
      baseUrl: instance.url.toString(),
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
