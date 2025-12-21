import type { BaseContext } from './context';
import type { Middleware } from './middleware';
import { toHTTPResponse } from './response';

export interface CorsConfig {
  origin: string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const DEFAULT_HEADERS = {
  'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].join(', '),

  // Safe default headers
  'Access-Control-Allow-Headers': [
    'Accept-Language',
    'Accept',
    'Content-Type',
    'Content-Language',
    'Range',
  ].join(', '),

  'Access-Control-Expose-Headers': [
    'Cache-Control',
    'Content-Language',
    'Content-Type',
    'Expires',
    'Last-Modified',
    'Pragma',
  ].join(', '),

  // 1 hour
  'Access-Control-Max-Age': '3600',
} as const;

export function createCORSMiddleware(config: CorsConfig): Middleware<unknown, unknown, BaseContext> {
  const cachedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(config.methods?.length && { 'Access-Control-Allow-Methods': config.methods.join(', ') }),
    ...(config.allowedHeaders?.length && { 'Access-Control-Allow-Headers': config.allowedHeaders.join(', ') }),
    ...(config.exposedHeaders?.length && { 'Access-Control-Expose-Headers': config.exposedHeaders.join(', ') }),
    ...((config.credentials && !config.origin.includes('*')) && { 'Access-Control-Allow-Credentials': 'true' }),
    ...(config.maxAge && { 'Access-Control-Max-Age': config.maxAge.toString() }),
  };

  return async (options) => {
    // If not an HTTP protocol, skip CORS
    if (!('request' in options.context)) return options.next();

    const origin = options.context.request.headers.get('Origin');

    // If no origin or not allowed, skip CORS
    if (!origin || !config.origin.includes(origin)) return options.next();

    // Preflight request
    if (options.context.request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          ...cachedHeaders,
        },
      });
    }

    // Actual request
    const response = toHTTPResponse(await options.next());

    // Set CORS headers
    response.headers.set('Access-Control-Allow-Origin', origin);
    for (const header in cachedHeaders) response.headers.set(header, cachedHeaders[header]!);
    return response;
  };
}
