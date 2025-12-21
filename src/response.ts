import type { Result } from './rpc';
import { UltraError } from './error';

export function toHTTPResponse(data: unknown): Response {
  switch (true) {
    case data instanceof Response:
      return data;
    case data instanceof UltraError:
      return data.toResponse();
    case data instanceof Error:
      return new Response('Internal Server Error', { status: 500 });
    case typeof data === 'object':
      return Response.json(data);
    case !data:
      return new Response(null, { status: 204 });
    default:
      return new Response(String(data));
  }
}

export function toRPCResponse(id: string, data: unknown): string {
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
    case typeof data === 'object' || typeof data === 'number' || typeof data === 'boolean':
      // @ts-expect-error mojet
      result = { id, result: data };
      break;
    default:
      result = { id, result: String(data) };
  }
  return JSON.stringify(result);
}
