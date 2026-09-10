import type { Promisable } from './types';

/** Payload exchanged between server and client by a {@link Serializer}. */
export type WireData = string | Uint8Array;

/**
 * Pluggable codec used to encode RPC payloads and results.
 *
 * Implement this interface to support values that JSON cannot represent
 * (`bigint`, `Map`, `Set`, custom classes), to plug in a third-party
 * serialization library (superjson, MessagePack, CBOR, protobuf, ...), or to
 * produce binary frames.
 *
 * `serialize`/`deserialize` may be synchronous or asynchronous, and the encoded
 * form may be a `string` (WebSocket text frame / `text/*` HTTP body) or a
 * `Uint8Array` (binary frame / binary HTTP body).
 *
 * The same serializer must be configured on the server and on every client,
 * otherwise the wire formats won't match.
 */
export interface Serializer {
  /** HTTP `Content-Type` used for encoded payloads (for example `application/json`). */
  contentType: string;

  /** Encode a value. Return `undefined` to send no payload at all. */
  serialize: (value: unknown) => Promisable<WireData | undefined>;

  /**
   * Decode a payload received from the transport.
   *
   * Text codecs may receive a `string` (WebSocket text frame) or a `Uint8Array`
   * (HTTP body / binary frame). Use {@link toText} to normalize if needed.
   */
  deserialize: (data: WireData) => Promisable<unknown>;

  /**
   * Whether the encoded form is binary.
   *
   * When `false` (the default), HTTP transports read and write UTF-8 strings
   * directly, skipping an extra encode/decode round trip. Set it to `true` for
   * codecs that produce bytes (MessagePack, CBOR, protobuf, compression, ...).
   *
   * @default false
   */
  binary?: boolean;
}

/** Identity helper that preserves the type of an inline serializer definition. */
export function defineSerializer<T extends Serializer>(serializer: T): T {
  return serializer;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Normalize text/binary wire data to a string. */
export function toText(data: WireData): string {
  return typeof data === 'string' ? data : textDecoder.decode(data);
}

/** Normalize text/binary wire data to bytes. */
export function toBytes(data: WireData): Uint8Array {
  return typeof data === 'string' ? textEncoder.encode(data) : data;
}

/** Default serializer: plain JSON via `JSON.stringify` and `JSON.parse`. */
export const jsonSerializer: Serializer = defineSerializer({
  contentType: 'application/json',
  // `JSON.stringify` returns `undefined` for values it cannot represent
  // (for example `undefined` or functions), which means "no payload".
  serialize: value => JSON.stringify(value),
  deserialize: data => JSON.parse(toText(data)),
});
