import { describe, expect, it } from 'bun:test';
import { isRPC, isRPCResponse } from '../src/rpc';

describe('isRPC', () => {
  it('accepts objects with id and method', () => {
    expect(isRPC({ id: '1', method: 'ping' })).toBe(true);
    expect(isRPC({ id: '2', method: 'run', params: { foo: 'bar' } })).toBe(true);
  });

  it('rejects objects missing required fields', () => {
    expect(isRPC({ id: '1' })).toBe(false);
    expect(isRPC({ method: 'ping' })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isRPC(null)).toBe(false);
    expect(isRPC(undefined)).toBe(false);
    expect(isRPC('rpc')).toBe(false);
  });
});

describe('isRPCResponse', () => {
  it('accepts success results with id and result', () => {
    expect(isRPCResponse({ id: '1', result: 'ok' })).toBe(true);
    expect(isRPCResponse({ id: '2', result: { foo: 'bar' } })).toBe(true);
    expect(isRPCResponse({ id: '3', result: null })).toBe(true);
  });

  it('accepts error results with id and error', () => {
    expect(isRPCResponse({ id: '1', error: { code: 500, message: 'fail' } })).toBe(true);
  });

  it('rejects objects missing id', () => {
    expect(isRPCResponse({ result: 'ok' })).toBe(false);
    expect(isRPCResponse({ error: { code: 500, message: 'fail' } })).toBe(false);
  });

  it('rejects objects with id but missing both result and error', () => {
    expect(isRPCResponse({ id: '1' })).toBe(false);
    expect(isRPCResponse({ id: '2', method: 'ping' })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isRPCResponse(null)).toBe(false);
    expect(isRPCResponse(undefined)).toBe(false);
    expect(isRPCResponse('response')).toBe(false);
    expect(isRPCResponse(42)).toBe(false);
    expect(isRPCResponse(true)).toBe(false);
  });

  it('rejects arrays', () => {
    expect(isRPCResponse([{ id: '1', result: 'ok' }])).toBe(false);
  });
});
