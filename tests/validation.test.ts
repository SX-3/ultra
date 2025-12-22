import type { Result, StandardSchemaV1 } from '../src/validation';
import { describe, expect, expectTypeOf, it } from 'bun:test';
import { Ultra } from '../src/ultra';
import { start } from './utils';

function makeSchema<O>(validateFn: (input: unknown) => Result<O>): StandardSchemaV1<O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'unit-test',
      validate: validateFn,
    },
  };
}

const LoginSchema = makeSchema<{ username: string; password: string }>((value) => {
  if (typeof value === 'object' && value !== null && 'username' in value && 'password' in value) {
    return { value: value as { username: string; password: string } };
  }
  return { issues: [{ message: 'Invalid login data' }] };
});

const UserSchema = makeSchema<{ username: string; id: number }>((value) => {
  if (typeof value === 'object' && value !== null && 'username' in value && 'id' in value) {
    return { value: value as { username: string; id: number } };
  }
  return { issues: [{ message: 'Invalid user data' }] };
});

const app = new Ultra().routes(input => ({
  auth: {
    login: input(LoginSchema)
      .output(UserSchema)
      .http()
      .handler(({ input }) => {
        expect(input).toContainAllKeys(['username', 'password']);
        expectTypeOf(input).toEqualTypeOf<{ username: string; password: string }>();
        return { username: input.username, id: 1 };
      }),
  },
}));

describe('validate', async () => {
  const { http, ws, isReady } = start(app);
  await isReady;

  it('returns validated output', async () => {
    const data = { username: 'test', password: 'secret' };
    const [userHTTP, userWS] = await Promise.all([
      http.auth.login(data),
      ws.auth.login(data),
    ]);

    expect(userHTTP).toEqual({ username: 'test', id: 1 });
    expectTypeOf(userHTTP).toExtend<{ username: string; id: number }>();
    expect(userWS).toEqual({ username: 'test', id: 1 });
    expectTypeOf(userWS).toExtend<{ username: string; id: number }>();
  });

  it('throws ValidationError with formatted issues when validation fails', async () => {
    const invalidData = { username: 'test' }; // Missing password
    // @ts-expect-error Testing invalid input
    expect(http.auth.login(invalidData)).rejects.toThrow();
    // @ts-expect-error Testing invalid input
    expect(ws.auth.login(invalidData)).rejects.toThrow();
  });
});
