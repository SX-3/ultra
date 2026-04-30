import type { BaseContext } from './context';
import type { Middleware } from './middleware';
import { isHTTP } from './context';
import { toHTTPResponse } from './response';

export interface CorsConfig {
  origin: string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const PREFLIGHT_DEFAULTS: Record<string, string> = {
  'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].join(', '),
  'Access-Control-Allow-Headers': ['Content-Type', 'Authorization'].join(', '),
  'Access-Control-Max-Age': '3600',
};

export function createCORSMiddleware(config: CorsConfig): Middleware<unknown, unknown, BaseContext> {
  // Preflight-only headers — only meaningful on OPTIONS responses per the Fetch spec.
  // https://fetch.spec.whatwg.org/#http-access-control-allow-methods
  const preflightHeaders: Record<string, string> = {
    ...PREFLIGHT_DEFAULTS,
    ...(config.methods?.length && { 'Access-Control-Allow-Methods': config.methods.join(', ') }),
    ...(config.allowedHeaders?.length && { 'Access-Control-Allow-Headers': config.allowedHeaders.join(', ') }),
    ...(config.maxAge !== undefined && { 'Access-Control-Max-Age': config.maxAge.toString() }),
  };

  const responseHeaders: Record<string, string> = {
    ...(config.exposedHeaders?.length && { 'Access-Control-Expose-Headers': config.exposedHeaders.join(', ') }),
    ...((config.credentials && !config.origin.includes('*')) && { 'Access-Control-Allow-Credentials': 'true' }),
  };

  return async (options) => {
    // If not an HTTP protocol, skip CORS
    if (!isHTTP(options.context)) return options.next();

    const origin = options.context.request.headers.get('Origin');

    // If no origin or not allowed, skip CORS
    if (!origin || !config.origin.includes(origin)) return options.next();

    if (options.context.request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          ...preflightHeaders,
          ...responseHeaders,
        },
      });
    }

    let response: Response;
    try {
      response = toHTTPResponse(await options.next());
    }
    catch (error) {
      response = toHTTPResponse(error);
    }

    response.headers.set('Access-Control-Allow-Origin', origin);
    for (const header in responseHeaders) {
      response.headers.set(header, responseHeaders[header]!);
    }

    return response;
  };
}
