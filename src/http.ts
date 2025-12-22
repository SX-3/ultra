import type { BunRequest, Server } from 'bun';
import type { DefaultSocketData } from './context';
import type { Promisable } from './types';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type BunRouteHandler = ((request: BunRequest, server: Server<DefaultSocketData>) => Promisable<Response | undefined>) | Response;
export type BunRoutes = Record<string, Partial<Record<HTTPMethod, BunRouteHandler>> | BunRouteHandler>;
