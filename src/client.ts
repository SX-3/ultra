import type { GetInput, GetOutput, Procedure } from './procedure';
import type { Payload, Result } from './rpc';
import type { JSONValue, Simplify } from './types';
import type { ProceduresMap, Ultra } from './ultra';
import { compress } from './compression';

type Timeout = ReturnType<typeof setTimeout>;
type SocketMessage = string | Blob | ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;
type GetProcedures<T> = T extends Ultra<infer P, any, any> ? P : never;

type ClientFunction<I, O, IO>
  = undefined extends I
    ? (input?: GetInput<I>, invokeOptions?: IO) => Promise<GetOutput<O>>
    : (input: GetInput<I>, invokeOptions?: IO) => Promise<GetOutput<O>>;

type BuildClient<P, CO> = Simplify<{
  [K in keyof P]: P[K] extends ProceduresMap
    ? BuildClient<P[K], CO>
    : P[K] extends Procedure<infer I, infer O, any>
      ? ClientFunction<I, O, CO>
      : never;
}>;

type Invoke<CO> = (method: string, params: any, invokeOptions?: CO) => Promise<unknown>;

function proxyClient<P extends ProceduresMap, IO>(invoke: Invoke<IO>, path: string[] = []): BuildClient<P, IO> {
  return new Proxy(() => {}, {
    get(_, prop) {
      if (typeof prop === 'string') return proxyClient<P, IO>(invoke, [...path, prop]);
    },

    apply(_, __, args) {
      if (!path.length) throw new Error('Cannot call client root; select a procedure first');
      const method = path.join('/');
      const params = args[0];
      const invokeOptions = args[1];
      return invoke(method, params, invokeOptions);
    },
  }) as any;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const result = new Headers();

  for (const headersInit of sources) {
    if (!headersInit) continue;
    new Headers(headersInit).forEach((value, key) => result.set(key, value));
  }

  return result;
}

interface HTTPClientOptions extends Omit<RequestInit, 'body'> {
  baseUrl: string;
  /** @default 10 seconds */
  timeout?: number;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createHTTPClient<U extends Ultra<any, any, any>>(clientOptions: HTTPClientOptions) {
  const invoke: Invoke<Partial<HTTPClientOptions>> = async (method, params, invokeOptions) => {
    const options = { ...clientOptions, ...invokeOptions };

    const timeout = options?.timeout || 10000;
    const httpMethod = options?.method || 'POST';
    let url = `${options.baseUrl}/${method}`;
    const headers = mergeHeaders(clientOptions?.headers, options?.headers, invokeOptions?.headers);
    let body: BodyInit | null = null;

    switch (true) {
      case httpMethod === 'GET': {
        body = null;
        if (!params) break;
        if (typeof params !== 'object') throw new Error('GET requests params to be an object for query string generation');
        const entries = Object.entries(params as Record<string, unknown>)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)] as [string, string]);
        const queryString = new URLSearchParams(entries).toString();
        if (queryString) url += `?${queryString}`;
        break;
      }
      case params instanceof FormData:
        body = params;
        break;
      case typeof params === 'string':
        headers.set('Content-Type', 'text/plain');
        body = params;
        break;
      default:
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(params);
    }

    try {
      const response = await fetch(url, {
        method: httpMethod,
        ...(body && { body }),
        ...options,
        signal: AbortSignal.timeout(timeout),
        headers,
      });

      if (!response.ok) throw new Error(`${response.statusText} ${response.status}`);
      const type = response.headers.get('Content-Type') || '';
      switch (true) {
        case response.status === 204:
          return null;
        case type.startsWith('application/json'):
          return await response.json();
        case type.startsWith('text/'):
          return await response.text();
        default:
          return await response.blob();
      }
    }
    catch (error: any) {
      if (error.name === 'AbortError') throw new Error(`Request aborted: ${error.message}`);
      throw error;
    }
  };

  return proxyClient<GetProcedures<U>, Partial<HTTPClientOptions>>(invoke);
}

interface WebSocketClientOptions {
  /** Socket getter */
  socket: () => WebSocket | null;

  /** @default 10000ms */
  timeout?: number;
  /**
   * @default 99
   * Set 1 for disable
   */
  batchSize?: number;

  /** @default 0 */
  batchDelay?: number;

  /** @default 1000 characters */
  compression?: number | false;

  /** @default 3 */
  retryCount?: number;

  /** @default 1000ms */
  retryDelay?: number;

  /** Call before send, you can modify data */
  onBeforeSend?: (data: SocketMessage) => SocketMessage | void;
}

interface WebSocketInvokeOptions {
  timeout?: number;
}

interface WebSocketRequest {
  id: string;
  method: string;
  params: JSONValue;
  options?: WebSocketInvokeOptions;
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
  timeout: Timeout;
  ws: WebSocket | null;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createWebSocketClient<U extends Ultra<any, any, any>>(clientOptions: WebSocketClientOptions) {
  const {
    batchSize = 99,
    batchDelay = 0,
    onBeforeSend,
    compression,
  } = clientOptions;

  const makeId = () => Math.random().toString(36);
  const requests = new Map<string, WebSocketRequest>();
  const encoder = new TextEncoder();

  let batchTimeout: Timeout | null = null;

  const onMessage = (event: MessageEvent) => {
    const ws = event.target as WebSocket;

    try {
      const response: Result = JSON.parse(event.data);
      const request = requests.get(response.id);
      if (!request || request.ws !== ws) return;

      clearTimeout(request.timeout);
      if ('error' in response) request.reject(response.error);
      else request.resolve(response.result);
      if (!requests.values().some(r => r.ws === ws)) {
        ws.removeEventListener('message', onMessage);
      };
    }
    catch (error) {
      console.error('Client failed parse server message', error);
    }
  };

  const onClose = (event: Event) => {
    const ws = event.target as WebSocket;
    ws.removeEventListener('message', onMessage);
    for (const [_, request] of requests) {
      if (ws === request.ws) request.reject('Socket close');
    }
  };

  const wrapWithClean = <F extends (...any: any[]) => any>(id: string, fn: F) => {
    return (...args: Parameters<F>) => {
      const request = requests.get(id);
      if (request) {
        clearTimeout(request.timeout);
        requests.delete(id);
      }
      return fn(...args);
    };
  };

  const closeOptions: AddEventListenerOptions = { once: true };

  const send = async () => {
    if (batchTimeout !== null) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }

    const socket = clientOptions.socket();

    if (!requests.size || !socket) return;

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, closeOptions);
    socket.addEventListener('error', onClose, closeOptions);

    const payloads: Payload[] = [];

    for (const [id, request] of requests) {
      if (request.ws) continue;
      request.ws = socket;
      payloads.push({
        id,
        method: request.method,
        params: request.params,
      });
    }

    if (!payloads.length) return;

    const string = JSON.stringify(payloads);
    if (compression && string.length >= compression) {
      const buffer = await compress(encoder.encode(string));
      socket.send(onBeforeSend?.(buffer) ?? buffer);
    }
    else {
      socket.send(onBeforeSend?.(string) ?? string);
    }
  };

  const invoke: Invoke<WebSocketInvokeOptions> = (method, params, invokeOptions) => {
    const options = { timeout: 10000, ...clientOptions, ...invokeOptions };

    const { promise, resolve, reject } = Promise.withResolvers();

    const id = makeId();

    requests.set(id, {
      id,
      method,
      params,
      options,
      resolve: wrapWithClean(id, resolve),
      reject: wrapWithClean(id, reject),
      timeout: setTimeout(wrapWithClean(id, reject), options.timeout),
      ws: null,
    });

    if (requests.size >= batchSize) {
      send().catch(console.error);
    }
    else if (batchTimeout === null) {
      batchTimeout = setTimeout(
        () => send().catch(console.error),
        batchDelay,
      );
    }

    return promise;
  };

  return proxyClient<GetProcedures<U>, WebSocketInvokeOptions>(invoke);
}

type ClientsCallsParams = Partial<WebSocketClientOptions> | Partial<HTTPClientOptions>;

interface SuperClientOptions<B extends Ultra<any, any, any>> {
  pick: (...args: Parameters<Invoke<ClientsCallsParams>>) => BuildClient<GetProcedures<B>, ClientsCallsParams>;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createSuperClient<B extends Ultra<any, any, any>>(options: SuperClientOptions<B>) {
  const invoke: Invoke<ClientsCallsParams> = (method, params, callOptions) => {
    const client = options.pick(method, params, callOptions);
    const segments = method.split('/').filter(Boolean);
    let target: any = client;
    for (const segment of segments) {
      if (target[segment]) target = target[segment];
    }

    return target(params, callOptions);
  };

  return proxyClient<GetProcedures<B>, ClientsCallsParams>(invoke);
}
