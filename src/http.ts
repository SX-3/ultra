import type { BunRequest, Server } from 'bun';
import type { Promisable } from './types';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type BunRouteHandler = (request: BunRequest, server: Server<unknown>) => Promisable<Response>;
export type BunRoutes = Record<string, Partial<Record<HTTPMethod, BunRouteHandler>> | BunRouteHandler>;
