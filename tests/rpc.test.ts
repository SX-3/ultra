import { describe, expect, it } from 'bun:test';
import { isRPC } from '../src/rpc';

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
