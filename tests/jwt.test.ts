import { expect, it } from 'bun:test';
import { createJWT, verifyJWT } from '../src/jwt';

const secret = 'test-secret-123' as const;

const NOW_SECONDS = Math.floor(Date.now() / 1000);

it('should create valid JWT token with correct format', () => {
  const payload = { userId: '123', role: 'admin' };
  const token = createJWT(payload, secret);

  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

  const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
  expect(header).toEqual({ typ: 'JWT', alg: 'HS256' });
});

it('should verify valid token and return payload', () => {
  const payload = { userId: '123', iss: 'my-app' };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);

  expect(result).not.toBeNull();
  expect(result!.header).toEqual({ typ: 'JWT', alg: 'HS256' });
  // @ts-expect-error ?????
  expect(result!.payload?.userId).toBe('123');
  expect(result!.payload.iss).toBe('my-app');
});

it('should return null for wrong secret', () => {
  const payload = { userId: '123' };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, 'wrong-secret');
  expect(result).toBeNull();
});

it('should return null for malformed token', () => {
  expect(verifyJWT('not-a-jwt-token', secret)).toBeNull();
  expect(verifyJWT('part1.part2', secret)).toBeNull();
  expect(verifyJWT('', secret)).toBeNull();
  expect(verifyJWT('part1.part2.part3.part4', secret)).toBeNull();
});

it('should return null for invalid base64url in token parts', () => {
  const invalidToken = 'invalid-base64.not-base64.invalid-sig';
  const result = verifyJWT(invalidToken, secret);
  expect(result).toBeNull();
});

it('should handle timingSafeEqual with different buffer lengths', () => {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ test: 'data' })).toString('base64url');
  const shortSig = 'short';
  const token = `${header}.${payload}.${shortSig}`;

  const result = verifyJWT(token, secret);
  expect(result).toBeNull();
});

it('should accept token not expired', () => {
  const payload = { exp: NOW_SECONDS + 3600 };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).not.toBeNull();
});

it('should return null for expired token', () => {
  const payload = { exp: NOW_SECONDS - 1 };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).toBeNull();
});

it('should return null for token expiring now', () => {
  const payload = { exp: NOW_SECONDS };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).toBeNull();
});

it('should accept token with nbf in past', () => {
  const payload = { nbf: NOW_SECONDS - 3600 };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).not.toBeNull();
});

it('should return null for token with nbf in future', () => {
  const payload = { nbf: NOW_SECONDS + 3600 };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).toBeNull();
});

it('should accept token with nbf exactly now', () => {
  const payload = { nbf: NOW_SECONDS };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).not.toBeNull();
});

it('should handle token with both exp and nbf', () => {
  const payload = {
    nbf: NOW_SECONDS - 1800, // Стал валидным 30 минут назад
    exp: NOW_SECONDS + 1800, // Истечет через 30 минут
  };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).not.toBeNull();
});

it('should return null when exp is in past even if nbf is valid', () => {
  const payload = {
    nbf: NOW_SECONDS - 7200, // Стал валидным 2 часа назад
    exp: NOW_SECONDS - 3600, // Истек 1 час назад
  };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).toBeNull();
});

it('should handle token with additional payload fields', () => {
  const payload = {
    userId: '123',
    customField: { nested: true },
    arrayField: [1, 2, 3],
  };
  const token = createJWT(payload, secret);

  const result = verifyJWT(token, secret);
  expect(result).not.toBeNull();
  // @ts-expect-error ?????
  expect(result!.payload.userId).toBe('123');
  expect((result!.payload as any).customField).toEqual({ nested: true });
  expect((result!.payload as any).arrayField).toEqual([1, 2, 3]);
});
