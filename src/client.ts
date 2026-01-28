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
    const controller = new AbortController();
    const httpMethod = options?.method || 'POST';
    let url = `${options.baseUrl}/${method}`;
    const headers = mergeHeaders(clientOptions?.headers, options?.headers, invokeOptions?.headers);
    let body: BodyInit | null = null;

    const abortTimeout = setTimeout(
      () => controller.abort(`Timeout: ${timeout}`),
      timeout,
    );

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
        signal: controller.signal,
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
    finally {
      clearTimeout(abortTimeout);
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
  pending: boolean;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createWebSocketClient<U extends Ultra<any, any, any>>(clientOptions: WebSocketClientOptions) {
  const {
    retryCount = 3,
    retryDelay = 1000,
    batchSize = 99,
    batchDelay = 0,
    onBeforeSend,
    compression,
  } = clientOptions;

  const makeId = () => Math.random().toString(36);
  const requests: WebSocketRequest[] = [];
  let batchTimeout: Timeout | null = null;

  const send = (retry = 0) => {
    if (batchTimeout !== null) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }

    if (!requests.length) return;

    const socket = clientOptions.socket();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (retry >= retryCount) {
        return requests.forEach((r) => {
          clearTimeout(r.timeout);
          r.reject('WebSocket is not open');
        });
      }
      return setTimeout(() => send(retry + 1), retryDelay);
    }

    const listener = (event: MessageEvent) => {
      try {
        const response: Result = JSON.parse(event.data);
        const request = requests.find(r => r.id === response.id);
        if (!request) return;
        clearTimeout(request.timeout);
        if ('error' in response) request.reject(response.error);
        else request.resolve(response.result);
        if (!requests.length) socket.removeEventListener('message', listener);
      }
      catch (error) {
        console.error('Client failed parse server message', error);
      }
    };

    socket.addEventListener('message', listener);
    socket.addEventListener('close', () => {
      socket.removeEventListener('message', listener);
      setTimeout(send, retryDelay);
    });

    const payloads: Payload[] = [];
    for (const request of requests) {
      if (request.pending) continue;
      request.pending = true;
      payloads.push({
        id: request.id,
        method: request.method,
        params: request.params,
      });
    }

    const string = JSON.stringify(payloads);
    if (compression && string.length >= compression) {
      const text = new TextEncoder().encode(string);
      compress(text).then(buffer => socket.send(onBeforeSend?.(buffer) ?? buffer));
    }
    else {
      socket.send(onBeforeSend?.(string) ?? string);
    }
  };

  const wrapWithClean = <F extends (...any: any[]) => any>(id: string, fn: F) => {
    return (...args: Parameters<F>) => {
      const index = requests.findIndex(r => r.id === id);
      if (index !== -1) {
        clearTimeout(requests[index]!.timeout);
        requests.splice(index, 1);
      }

      return fn(...args);
    };
  };

  const invoke: Invoke<WebSocketInvokeOptions> = (method, params, invokeOptions) => {
    const options = { timeout: 10000, ...clientOptions, ...invokeOptions };

    const { promise, resolve, reject } = Promise.withResolvers();

    const id = makeId();

    requests.push({
      id,
      method,
      params,
      options,
      resolve: wrapWithClean(id, resolve),
      reject: wrapWithClean(id, reject),
      timeout: setTimeout(wrapWithClean(id, reject), options.timeout),
      pending: false,
    });

    if (requests.length >= batchSize) send();
    else if (batchTimeout === null) batchTimeout = setTimeout(send, batchDelay);

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
