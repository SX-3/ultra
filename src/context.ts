import type { BunRequest, Server, ServerWebSocket } from 'bun';

export type DefaultSocketData = Record<string, any>;

export interface HTTPContext {
  server: Server<DefaultSocketData>;
  request: BunRequest;
}

export interface WSContext<SocketData> {
  server: Server<SocketData>;
  ws: ServerWebSocket<SocketData>;
}

export type BaseContext<SocketData extends DefaultSocketData = any> = HTTPContext | WSContext<SocketData>;

export function isHTTP(context: BaseContext): context is HTTPContext {
  return 'request' in context;
}

export function isWS<SocketData extends DefaultSocketData = DefaultSocketData>(context: BaseContext): context is WSContext<SocketData> {
  return 'ws' in context;
}
