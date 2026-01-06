import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JWTHeader {
  typ: 'JWT';
  alg: 'HS256';
}

export interface JWTPayload extends Record<string, any> {
  iat?: number; // issued at, in seconds since epoch
  exp?: number; // expiration time, in seconds since epoch
  nbf?: number; // not before, in seconds since epoch
  iss?: string; // issuer
}

export interface JWT {
  header: JWTHeader;
  payload: JWTPayload;
}

const defaultHeader: JWTHeader = { typ: 'JWT', alg: 'HS256' };

export function createJWT(payload: JWTPayload, secret: string): string {
  payload = { iat: Math.floor(Date.now() / 1000), ...payload };

  const base64Header = Buffer.from(JSON.stringify(defaultHeader)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${base64Header}.${base64Payload}`;
  const sig = createHmac('sha256', secret).update(token).digest('base64url');
  return `${token}.${sig}`;
}

export function verifyJWT(token: string, secret: string): JWT | null {
  const [base64Header, base64Payload, signature] = token.split('.');
  if (!signature || !base64Payload || !base64Header) return null;
  const expectedSig = createHmac('sha256', secret).update(`${base64Header}.${base64Payload}`).digest('base64url');
  const sigBuf = Buffer.from(signature, 'base64url');
  const expectedSigBuf = Buffer.from(expectedSig, 'base64url');
  if (sigBuf.length !== expectedSigBuf.length) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    if (!timingSafeEqual(sigBuf, expectedSigBuf)) return null;

    const header = JSON.parse(Buffer.from(base64Header, 'base64url').toString()) as JWTHeader;
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString()) as JWTPayload;

    if (payload.exp && nowSeconds >= payload.exp) return null;
    if (payload.nbf && nowSeconds < payload.nbf) return null;

    return { header, payload };
  }
  catch {
    return null;
  }
}
