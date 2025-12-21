import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createCORSMiddleware } from '../src/cors';
import { Ultra } from '../src/ultra';

const PORT = 3001;
const ALLOWED_ORIGIN = 'https://allowed.com';
const DISALLOWED_ORIGIN = 'https://other.com';

const app = new Ultra()
  .use(createCORSMiddleware({
    origin: [ALLOWED_ORIGIN],
    methods: ['GET'],
    allowedHeaders: ['X-Test'],
    exposedHeaders: ['X-Expose'],
    credentials: true,
    maxAge: 99,
  }))
  .routes(input => ({
    ping: input().http({ method: 'GET' }).handler(() => ({ pong: true })),
  }));

beforeAll(async () => {
  await app.start({ port: PORT });
});

afterAll(async () => {
  await app.stop(true);
});

describe('CORS middleware integration', () => {
  it('responds to preflight with configured headers for allowed origin', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Test');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Expose');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('99');
  });

  it('attaches CORS headers to actual responses for allowed origin', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`, {
      method: 'GET',
      headers: {
        Origin: ALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Test');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Expose');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('99');
  });

  it('passes through without CORS headers for disallowed origin', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`, {
      method: 'GET',
      headers: {
        Origin: DISALLOWED_ORIGIN,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
