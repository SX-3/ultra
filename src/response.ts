import type { Result } from './rpc';
import type { Serializer, WireData } from './serializer';
import { UltraError } from './error';
import { jsonSerializer } from './serializer';

// `new Response(body, { headers: { ... } })` materializes a Headers instance on
// every call. A Headers object is copied by `Response`, so a memoized instance
// per content type can be safely reused.
const contentTypeHeaders = new Map<string, Headers>();

function headersFor(contentType: string): Headers {
  let headers = contentTypeHeaders.get(contentType);
  if (!headers) {
    headers = new Headers({ 'Content-Type': contentType });
    contentTypeHeaders.set(contentType, headers);
  }
  return headers;
}

/**
 * Convert a procedure result into an HTTP `Response`.
 *
 * This is the single serialization boundary for HTTP: every non-`Response`,
 * non-error, non-`undefined` value is encoded with `serializer`.
 */
export async function toHTTPResponse(data: unknown, serializer: Serializer = jsonSerializer): Promise<Response> {
  switch (true) {
    case data instanceof Response:
      return data;
    case data instanceof UltraError:
      return data.toResponse();
    case data instanceof Error:
      return new Response(data.message, { status: 500 });
    case data === undefined:
      return new Response(null, { status: 204 });
    default: {
      const body = await serializer.serialize(data);
      return new Response((body ?? String(data)) as unknown as BodyInit, {
        headers: headersFor(serializer.contentType),
      });
    }
  }
}

/** Convert a procedure result into an encoded RPC envelope. */
export async function toRPCResponse(
  id: string,
  data: unknown,
  serializer: Serializer = jsonSerializer,
): Promise<WireData> {
  let result: Result;
  switch (true) {
    case data instanceof UltraError:
      result = { id, error: { code: data.status, message: data.message } };
      break;
    case data instanceof Error:
      result = { id, error: { code: 500, message: data.message } };
      break;
    case data instanceof Response:
      result = { id, error: { code: data.status, message: data.statusText } };
      break;
    default:
      result = { id, result: data ?? null };
  }

  return await serializer.serialize(result) ?? '';
}
