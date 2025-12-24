import type { Procedure } from './procedure';
import type { Result } from './rpc';
import type { ProceduresMap, Ultra } from './ultra';

type GetProcedures<T> = T extends Ultra<infer P, any, any> ? P : never;

type BuildProcedure<P, CO> = P extends Procedure<infer I, infer O, any>
  ? (undefined extends I
      ? (input?: I, callOptions?: CO) => Promise<O>
      : (input: I, callOptions?: CO) => Promise<O>)
  : never;

type BuildClient<P extends ProceduresMap, CO> = {
  [K in keyof P]: P[K] extends Procedure<any, any, any>
    ? BuildProcedure<P[K], CO>
    : P[K] extends ProceduresMap
      ? BuildClient<P[K], CO>
      : never
};

type Invoke<CO> = (method: string, params: unknown, callOptions?: CO) => Promise<unknown>;

function proxyClient<P extends ProceduresMap, CO>(invoke: Invoke<CO>, path: string[] = []): BuildClient<P, CO> {
  return new Proxy(() => {}, {
    get(_, prop) {
      if (typeof prop === 'string') return proxyClient<P, CO>(invoke, [...path, prop]);
    },

    apply(_, __, args) {
      if (!path.length) throw new Error('Cannot call client root; select a procedure first');
      const method = path.join('/');
      const params = args[0];
      const callOptions = args[1];
      return invoke(method, params, callOptions);
    },
  }) as unknown as BuildClient<P, CO>;
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
  timeout?: number;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createHTTPClient<U extends Ultra<any, any, any>>(clientOptions: HTTPClientOptions) {
  const invoke: Invoke<Partial<HTTPClientOptions>> = async (method, params, callOptions) => {
    const options = { ...clientOptions, ...callOptions };

    const timeout = options?.timeout || 10000;
    const controller = new AbortController();
    const httpMethod = options?.method || 'POST';
    let url = `${options.baseUrl}/${method}`;
    const headers = mergeHeaders(clientOptions?.headers, options?.headers, callOptions?.headers);
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

      if (!response.ok) throw new Error(`HTTP error: ${response.statusText} ${response.status} `);
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
  socket: () => WebSocket | null;
  timeout?: number;
}

// Accept Ultra instances with any extended context/socket data while preserving procedure typing
export function createWebSocketClient<U extends Ultra<any, any, any>>(options: WebSocketClientOptions) {
  const { timeout = 10000 } = options;
  const makeId = () => Math.random().toString(36);

  const invoke: Invoke<Partial<WebSocketClientOptions>> = (method, params, callOptions) => {
    const socket = options.socket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not open'));
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    const mergedTimeout = callOptions?.timeout ?? timeout;
    let rejectTimeout: ReturnType<typeof setTimeout>;
    const requestId = makeId();

    const listener = (event: MessageEvent) => {
      try {
        const response: Result = JSON.parse(event.data);
        if (response.id !== requestId) return;
        clearTimeout(rejectTimeout);
        socket.removeEventListener('message', listener);
        if ('error' in response) return reject(response.error);
        return resolve(response.result);
      }
      catch (error) {
        reject(error);
      }
    };

    socket.addEventListener('message', listener);
    rejectTimeout = setTimeout(() => {
      socket.removeEventListener('message', listener);
      reject(`Timeout: ${mergedTimeout}`);
    }, mergedTimeout);

    socket.send(JSON.stringify({ id: requestId, method, params }));

    return promise;
  };

  return proxyClient<GetProcedures<U>, Partial<WebSocketClientOptions>>(invoke);
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
