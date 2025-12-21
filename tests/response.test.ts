import { describe, expect, it } from 'bun:test';
import { ValidationError } from '../src/error';
import { toHTTPResponse, toRPCResponse } from '../src/response';

const readText = async (response: Response | undefined) => response ? response.text() : undefined;

describe('toHTTPResponse', () => {
  it('returns responses unchanged', () => {
    const response = new Response('ok', { status: 201 });
    expect(toHTTPResponse(response)).toBe(response);
  });

  it('converts BaseError to JSON response', async () => {
    const error = new ValidationError('nope');
    const response = toHTTPResponse(error);

    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toEqual({
      error: { name: 'ValidationError', message: 'nope' },
    });
  });

  it('wraps generic errors as 500 responses', async () => {
    const response = toHTTPResponse(new Error('boom'));

    expect(response?.status).toBe(500);
    await expect(readText(response)).resolves.toBe('Internal Server Error');
  });

  it('serializes plain objects as JSON', async () => {
    const body = { hello: 'world' };
    const response = toHTTPResponse(body);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual(body);
  });

  it('uses 204 for undefined-like values', async () => {
    const response = toHTTPResponse(undefined);

    expect(response?.status).toBe(204);
    await expect(readText(response)).resolves.toBe('');
  });

  it('stringifies other values', async () => {
    const response = toHTTPResponse(123n);

    expect(response?.status).toBe(200);
    await expect(readText(response)).resolves.toBe('123');
  });
});

describe('toRPCResponse', () => {
  it('wraps BaseError details', () => {
    const error = new ValidationError('invalid');
    const parsed = JSON.parse(toRPCResponse('1', error));

    expect(parsed).toEqual({ id: '1', error: { code: 422, message: 'invalid' } });
  });

  it('wraps generic errors with status 500', () => {
    const parsed = JSON.parse(toRPCResponse('2', new Error('oops')));

    expect(parsed).toEqual({ id: '2', error: { code: 500, message: 'oops' } });
  });

  it('wraps Response status as error', () => {
    const response = new Response('nope', { status: 400, statusText: 'Bad Request' });
    const parsed = JSON.parse(toRPCResponse('3', response));

    expect(parsed).toEqual({ id: '3', error: { code: 400, message: 'Bad Request' } });
  });

  it('passes objects, numbers, and booleans through as results', () => {
    expect(JSON.parse(toRPCResponse('4', { ok: true }))).toEqual({ id: '4', result: { ok: true } });
    expect(JSON.parse(toRPCResponse('5', 42))).toEqual({ id: '5', result: 42 });
    expect(JSON.parse(toRPCResponse('6', false))).toEqual({ id: '6', result: false });
  });

  it('stringifies other values as results', () => {
    expect(JSON.parse(toRPCResponse('7', 'hi'))).toEqual({ id: '7', result: 'hi' });
  });
});
