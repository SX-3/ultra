import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm' as const;
const ENCODING = 'base64url' as const;
const IV_LEN = 12 as const;
const TAG_LEN = 16 as const;

export function sign(value: string, secret: string) {
  const base64 = Buffer.from(value).toString(ENCODING);
  const sig = createHmac('sha256', secret).update(base64).digest(ENCODING);
  return `${base64}.${sig}`;
}

export function unsign(signedValue: string, secret: string) {
  const [base64, sig] = signedValue.split('.');
  if (!base64 || !sig) return null;
  const expectedSig = createHmac('sha256', secret).update(base64).digest(ENCODING);
  const a = Buffer.from(sig, ENCODING);
  const b = Buffer.from(expectedSig, ENCODING);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(base64, ENCODING).toString();
}

export function encrypt(value: string, secret: string) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, secret, iv);
  let enc = cipher.update(value, 'utf-8', ENCODING);
  enc += cipher.final(ENCODING);
  return Buffer.concat([iv, cipher.getAuthTag(), Buffer.from(enc, ENCODING)]).toString(ENCODING);
}

export function decrypt(encrypted: string, secret: string) {
  const data = Buffer.from(encrypted, ENCODING);
  if (data.length < IV_LEN + TAG_LEN) return null;
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const cipherText = data.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, secret, iv);
  decipher.setAuthTag(tag);
  return `${decipher.update(cipherText, undefined, 'utf-8')}${decipher.final('utf-8')}`;
}
