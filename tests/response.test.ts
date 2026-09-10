import { describe, expect, it } from 'bun:test';
import { ValidationError } from '../src/error';
import { toHTTPResponse, toRPCResponse } from '../src/response';

describe('toHTTPResponse', () => {
  it('returns responses unchanged', async () => {
    const response = new Response('ok', { status: 201 });
    expect(await toHTTPResponse(response)).toBe(response);
  });

  it('converts BaseError to JSON response', async () => {
    const response = await toHTTPResponse(new ValidationError('nope'));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { name: 'ValidationError', message: 'nope' },
    });
  });

  it('wraps generic errors as 500 responses', async () => {
    const response = await toHTTPResponse(new Error('boom'));

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toEqual('boom');
  });

  it('serializes plain objects as JSON', async () => {
    const body = { hello: 'world' };
    const response = await toHTTPResponse(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(body);
  });

  it('uses 204 for undefined', async () => {
    const response = await toHTTPResponse(undefined);

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
  });

  it('serializes primitives with the serializer', async () => {
    const response = await toHTTPResponse(123);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    await expect(response.text()).resolves.toBe('123');
  });

  it('rejects values the JSON serializer cannot represent', async () => {
    await expect(toHTTPResponse(123n)).rejects.toThrow();
  });
});

describe('toRPCResponse', () => {
  it('wraps BaseError details', async () => {
    const parsed = JSON.parse(await toRPCResponse('1', new ValidationError('invalid')) as string);

    expect(parsed).toEqual({ id: '1', error: { code: 422, message: 'invalid' } });
  });

  it('wraps generic errors with status 500', async () => {
    const parsed = JSON.parse(await toRPCResponse('2', new Error('oops')) as string);

    expect(parsed).toEqual({ id: '2', error: { code: 500, message: 'oops' } });
  });

  it('wraps Response status as error', async () => {
    const response = new Response('nope', { status: 400, statusText: 'Bad Request' });
    const parsed = JSON.parse(await toRPCResponse('3', response) as string);

    expect(parsed).toEqual({ id: '3', error: { code: 400, message: 'Bad Request' } });
  });

  it('passes results through as results', async () => {
    expect(JSON.parse(await toRPCResponse('4', { ok: true }) as string)).toEqual({ id: '4', result: { ok: true } });
    expect(JSON.parse(await toRPCResponse('5', 42) as string)).toEqual({ id: '5', result: 42 });
    expect(JSON.parse(await toRPCResponse('6', false) as string)).toEqual({ id: '6', result: false });
    expect(JSON.parse(await toRPCResponse('7', 'hi') as string)).toEqual({ id: '7', result: 'hi' });
  });

  it('normalizes undefined results to null', async () => {
    expect(JSON.parse(await toRPCResponse('8', undefined) as string)).toEqual({ id: '8', result: null });
  });
});
