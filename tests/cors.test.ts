import { describe, expect, it } from 'bun:test';
import { createCORSMiddleware } from '../src/cors';
import { Ultra } from '../src/ultra';
import { start } from './utils';

const ORIGINS = ['http://allowed.com', 'http://also-allowed.com'];
const app = new Ultra()
  .use(createCORSMiddleware({
    origin: ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['X-Test'],
    exposedHeaders: ['X-Expose'],
    credentials: true,
    maxAge: 99,
  }))
  .routes(input => ({
    ping: input().http().handler(() => 'pong'),
  }));

describe('CORS middleware integration', async () => {
  const { url } = start(app);

  it('responds to preflight with configured headers for allowed origin', async () => {
    const ALLOWED_ORIGIN = ORIGINS[0]!;
    const res = await fetch(`${url}/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Test');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Expose');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('99');
  });

  it('attaches CORS headers to actual responses for allowed origin', async () => {
    const ALLOWED_ORIGIN = ORIGINS[1]!;
    const res = await fetch(`${url}/ping`, {
      method: 'GET',
      headers: {
        Origin: ALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toEqual('pong');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Test');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Expose');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('99');
  });

  it('passes through without CORS headers for disallowed origin', async () => {
    const DISALLOWED_ORIGIN = 'http://disallowed.com';
    const res = await fetch(`${url}/ping`, {
      method: 'GET',
      headers: {
        Origin: DISALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toEqual('pong');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('passes through without CORS headers when no Origin header is present', async () => {
    const res = await fetch(`${url}/ping`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toEqual('pong');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
