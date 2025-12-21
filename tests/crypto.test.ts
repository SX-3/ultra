import { describe, expect, it } from 'bun:test';
import { decrypt, encrypt, sign, unsign } from '../src/crypto';

const SECRET = '0123456789abcdef0123456789abcdef' as const;
const WRONG_SECRET = 'fedcba9876543210fedcba9876543210' as const;

describe('sign/unsign', () => {
  it('roundtrips with a valid signature', () => {
    const value = 'hello-world';
    const signed = sign(value, SECRET);

    expect(signed.split('.')).toHaveLength(2);
    expect(unsign(signed, SECRET)).toBe(value);
  });

  it('rejects invalid signatures and secrets', () => {
    const value = 'payload';
    const signed = sign(value, SECRET);

    expect(unsign(signed, WRONG_SECRET)).toBeNull();
    const [base64] = signed.split('.');
    const tampered = `${base64}.bad-signature`;
    expect(unsign(tampered, SECRET)).toBeNull();
    expect(unsign('broken.value', SECRET)).toBeNull();
  });
});

describe('encrypt/decrypt', () => {
  it('encrypts and decrypts the original value', () => {
    const value = 'top secret message';
    const encrypted = encrypt(value, SECRET);

    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain(value);
    expect(decrypt(encrypted, SECRET)).toBe(value);
  });

  it('uses a random IV to produce different cipher texts', () => {
    const value = 'repeatable';
    const first = encrypt(value, SECRET);
    const second = encrypt(value, SECRET);

    expect(first).not.toBe(second);
  });

  it('throws when decrypted with the wrong secret', () => {
    const encrypted = encrypt('classified', SECRET);
    expect(() => decrypt(encrypted, WRONG_SECRET)).toThrow();
  });
});
