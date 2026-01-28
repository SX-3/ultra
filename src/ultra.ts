import type { BunRequest, ErrorLike, Server, ServerWebSocket } from 'bun';
import type { BaseContext, DeriveRecord, DeriveUpgradeValue, DeriveValue, GetDerived, GetDerivedUpgradeData, ReplaceSocketData } from './context';
import type { BunRouteHandler, BunRoutes } from './http';
import type { Middleware } from './middleware';
import type { ProcedureHandler, ProcedureOptions } from './procedure';
import type { Payload } from './rpc';
import type { Simplify } from './types';
import type { StandardSchemaV1 as Schema } from './validation';
import { inflateSync, serve } from 'bun';

import { Procedure } from './procedure';
import { toHTTPResponse, toRPCResponse } from './response';
import { isRPC } from './rpc';

export interface ProceduresMap {
  [key: string]: Procedure<any, any, any> | ProceduresMap;
}

interface ServerEventMap<SD> {
  'error': [ErrorLike];
  'unhandled:error': [ErrorLike];

  'http:request': [BunRequest, Server<SD>];

  'ws:open': [ServerWebSocket<SD>];
  'ws:message': [ServerWebSocket<SD>, string | Buffer<ArrayBuffer>];
  'ws:close': [ServerWebSocket<SD>, number, string];

  'server:started': [Server<SD>];
  'server:stopped': [Server<SD>, closeActiveConnections: boolean];
}

type ServerEventListener<SD, K extends keyof ServerEventMap<SD>> = (...args: ServerEventMap<SD>[K]) => any;

type StartOptions<SD> = Partial<Bun.Serve.Options<SD>>;

export type InputFactory<C> = <I>(schema?: Schema<unknown, I>) => Procedure<I, unknown, C>;
export type ProcedureMapInitializer<R extends ProceduresMap, C> = (input: InputFactory<C>) => R;

export interface UltraOptions {
  http?: {
    enableByDefault?: boolean;
  };
}

export class Ultra<
  const Procedures extends ProceduresMap = ProceduresMap,
  const SocketData extends DeriveRecord = DeriveRecord,
  const Context extends BaseContext<SocketData> = BaseContext<SocketData>,
> {
  protected readonly initializers = new Map<ProcedureMapInitializer<any, Context>, Set<Middleware<any, any, Context>>>();
  protected readonly events = new Map<keyof ServerEventMap<SocketData>, Set<ServerEventListener<SocketData, any>>>();
  protected readonly middlewares = new Set<Middleware<any, any, Context>>();
  protected readonly derived = new Set<DeriveValue<Context>>();
  protected readonly derivedUpgrade = new Set<DeriveUpgradeValue<Context>>();
  protected readonly options: UltraOptions = {
    http: { enableByDefault: false },
  };

  protected httpEnabled = false;
  protected server?: Server<SocketData>;

  constructor(options?: UltraOptions) {
    if (options) this.options = { ...this.options, ...options };
    this.httpEnabled = this.options.http?.enableByDefault ?? false;
  }

  /** Register procedures */
  routes<const P extends ProceduresMap>(
    initializer: ProcedureMapInitializer<P, Context>,
    middlewares?: Middleware<any, any, Context>[],
  ): Ultra<Procedures & P, SocketData, Context> {
    const existed = this.initializers.get(initializer);
    if (!existed) this.initializers.set(initializer, new Set(middlewares));
    else middlewares?.forEach(mw => existed.add(mw));
    return this;
  }

  /** Register middleware or another Ultra instance */
  use<
    const PluginProcedures extends ProceduresMap,
    const PluginSocketData extends DeriveRecord,
    const PluginContext extends BaseContext<PluginSocketData>,
  >(entity: Middleware<any, any, Context> | Ultra<PluginProcedures, PluginSocketData, PluginContext>,
  ): Ultra<
    Simplify<Procedures & PluginProcedures>,
    Simplify<SocketData & PluginSocketData>,
    Simplify<ReplaceSocketData<Context & PluginContext, SocketData & PluginSocketData>>
  > {
    // If entity is a middleware, add to middlewares set
    if (typeof entity === 'function') {
      this.middlewares.add(entity);
      return this as any;
    }
    // this.modules.add(entity as any);
    this.merge(entity);
    return this as any;
  }

  /** Extends context values for every request with provided values */
  derive<const D extends DeriveValue<Context>>(derive: D): Ultra<Procedures, SocketData, Simplify<Context & GetDerived<Context, D>>> {
    this.derived.add(derive);
    return this as any;
  }

  /** Extends socket data and return headers */
  deriveUpgrade<const D extends DeriveUpgradeValue<Context>>(derive: D): Ultra<
    Procedures,
    Simplify<SocketData & GetDerivedUpgradeData<Context, D>>,
    Simplify<ReplaceSocketData<Context, Simplify<SocketData & GetDerivedUpgradeData<Context, D>>>>
  > {
    this.derivedUpgrade.add(derive);
    return this as any;
  }

  /** Build procedures and start servers */
  start(options?: StartOptions<SocketData>) {
    if (this.server) {
      console.warn('Server is already running');
      return this.server;
    }

    const { routes, handlers } = this.build();

    // ? Shared text decoder
    const textDecoder = new TextDecoder();
    const notFoundHandler = this.wrapHandler(
      () => new Response('Not Found', { status: 404 }),
      this.middlewares,
    );

    this.server = serve<SocketData>({
      ...(this.httpEnabled && {
        routes: {
          // Procedure routes
          ...routes,
          '/ws': async (request, server) => {
            this.emit('http:request', request, server);
            if (!this.derivedUpgrade.size) {
              // @ts-expect-error Bun types
              if (!server.upgrade(request)) {
                return new Response('WebSocket upgrade failed', { status: 500 });
              };
              return;
            }

            if (!server.upgrade(
              request,
              // @ts-expect-error Bun types
              await this.enrichUpgrade(this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as any),
            )
            ) {
              return new Response('WebSocket upgrade failed', { status: 500 });
            };
          },

          // Not found handler
          '/*': async (request, server) => {
            this.emit('http:request', request, server);
            return notFoundHandler({
              input: null,
              context: this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as any,
            });
          },
        },
      }),

      websocket: {
        data: {} as SocketData,
        open: (ws) => { this.emit('ws:open', ws); },
        close: (ws, code, reason) => { this.emit('ws:close', ws, code, reason); },
        message: async (ws, message) => {
          this.emit('ws:message', ws, message);

          let data: object | null = null;

          try {
            if (typeof message === 'string') {
              data = JSON.parse(message);
            }
            else {
              data = JSON.parse(textDecoder.decode(inflateSync(message)));
            }
          }
          catch (error) {
            console.error('Message payload parsing failed', error);
            return;
          }

          const rpcs = Array.isArray(data) ? data.filter(isRPC) : isRPC(data) ? [data] : null;

          if (!rpcs || !rpcs.length) return;

          const context = this.derived.size ? await this.enrichContext({ server: this.server!, ws }) : { server: this.server!, ws } as any;

          for (const rpc of rpcs) {
            this.handleRPC(handlers.get(rpc.method), ws, rpc, context);
          }
        },
      },

      error: (error) => {
        this.emit('unhandled:error', error);
        console.error('Unhandled server error:', error);
        return new Response('Internal server error', { status: 500 });
      },

      ...options,
    } as Bun.Serve.Options<SocketData>);

    this.emit('server:started', this.server);
    return this.server;
  }

  /** Stop server */
  async stop(closeActiveConnections = false) {
    if (!this.server) return console.error('Server is not running');
    await this.server.stop(closeActiveConnections);
    this.emit('server:stopped', this.server, closeActiveConnections);
  }

  on<E extends keyof ServerEventMap<SocketData>>(event: E, listener: ServerEventListener<SocketData, E>) {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event)!.add(listener);
    return this;
  }

  off<E extends keyof ServerEventMap<SocketData>>(event: E, listener: ServerEventListener<SocketData, E>) {
    this.events.get(event)?.delete(listener);
    return this;
  }

  emit<E extends keyof ServerEventMap<SocketData>>(event: E, ...args: ServerEventMap<SocketData>[E]) {
    this.events.get(event)?.forEach(listener => listener(...args));
    return this;
  }

  protected async handleRPC(handler: ProcedureHandler<unknown, unknown, Context> | undefined, ws: ServerWebSocket<SocketData>, rpc: Payload, context: Context) {
    if (!handler) {
      ws.send(`{"id": "${rpc.id}", "error": {"code": 404, "message": "Not found"}}`);
      return;
    }

    try {
      ws.send(toRPCResponse(rpc.id, await handler({
        input: rpc.params,
        context,
      })));
    }
    catch (error) {
      this.emit('error', error as ErrorLike);
      ws.send(toRPCResponse(rpc.id, error));
    }
  }

  /** Enrich context with derived values */
  protected async enrichContext<const C extends BaseContext>(context: C): Promise<Context> {
    // ? Derive sequentially to allow using previous derived values
    for (const derive of this.derived) {
      Object.assign(
        context,
        typeof derive === 'function' ? await derive(context as any) : derive,
      );
    }

    return context as any;
  }

  /** Enrich upgrade options with derived values */
  protected async enrichUpgrade(context: Context) {
    const options = { data: {} as Record<PropertyKey, any>, headers: new Headers() };

    // ? Derive sequentially to allow using previous derived values
    for (const derive of this.derivedUpgrade) {
      const result = typeof derive === 'function' ? await derive(context) : derive;
      if ('data' in result) Object.assign(options.data, result.data);
      if ('headers' in result) {
        for (const [key, value] of Object.entries(result.headers)) {
          options.headers.set(key, value);
        }
      }
    }

    return options;
  }

  /** Merge other Ultra instance with deduplication */
  protected merge(module: Ultra<any, any, any>) {
    for (const [initializer, middlewares] of module.initializers) {
      const existed = this.initializers.get(initializer);
      if (!existed) this.initializers.set(initializer, new Set(middlewares));
      else middlewares.forEach(mw => existed.add(mw));
    }

    module.derived.forEach(derive => this.derived.add(derive));
    module.derivedUpgrade.forEach(derive => this.derivedUpgrade.add(derive));
    module.middlewares.forEach(mw => this.middlewares.add(mw));
    module.events.forEach((listeners, event) => {
      if (!this.events.has(event)) this.events.set(event, new Set());
      const targetListeners = this.events.get(event)!;
      listeners.forEach(listener => targetListeners.add(listener));
    });
  }

  /** Wrap procedure handler with global middlewares */
  protected wrapHandler<I, O>(handler: ProcedureHandler<I, O, Context>, middlewares: Set<Middleware<I, O, Context>>): ProcedureHandler<I, any, Context> {
    if (!middlewares.size) return handler;
    const middlewaresArray = Array.from(middlewares);
    const length = middlewaresArray.length;
    return async (options: ProcedureOptions<I, Context>) => {
      let idx = 0;
      const next = () => {
        if (idx === length) return handler(options);
        return middlewaresArray[idx++]!({ ...options, next });
      };
      return next();
    };
  }

  protected build() {
    const handlers = new Map<string, ProcedureHandler<any, any, Context>>();
    const routes: BunRoutes = {};

    const inputFactory: InputFactory<Context> = <I>(schema?: Schema<unknown, I>) => {
      const procedure = new Procedure<I, unknown, Context>();
      if (schema) procedure.input(schema);
      if (this.options.http?.enableByDefault) procedure.http();
      return procedure;
    };

    for (const [initializer, scopedMiddleware] of this.initializers) {
      const map = initializer(inputFactory) as Procedures;
      const stack: Array<{ path: string; value: Procedure<any, any, Context> | ProceduresMap }> = [];

      for (const path in map) {
        stack.push({ path, value: map[path]! });
      }

      while (stack.length) {
        const { path, value } = stack.pop()!;

        if (value instanceof Procedure) {
          if (handlers.has(path)) throw new Error(`Procedure "${path}" already exists`);

          const procedure = value.metadata();

          if (!this.httpEnabled && procedure.http?.enabled) this.httpEnabled = true;

          const middlewares = new Set([
            ...this.middlewares,
            ...scopedMiddleware,
            ...procedure.middlewares,
          ]);

          const handler = this.wrapHandler(value.compile(), middlewares);

          handlers.set(path, handler);

          // Skip if HTTP is disabled
          if (!procedure.http?.enabled) continue;

          const httpPath = `/${path}`;

          // ! Runtime logic edits may performance hit. Avoid adding logic that can be resolved at startup.
          const HTTPHandler: BunRouteHandler = async (request: BunRequest, server: Server<SocketData>) => {
            this.emit('http:request', request, server);

            let input: any = request.body;

            // Parse input
            if (input) {
              // Parse GET with query parameters
              if (request.method === 'GET') {
                const query = request.url.indexOf('?');
                if (query !== -1 && query < request.url.length - 1) {
                  input = Object.fromEntries(new URLSearchParams(request.url.slice(query + 1)).entries());
                }
              }
              else {
                // Have content
                if (request.headers.get('Content-Length') !== '0') {
                  const type = request.headers.get('Content-Type');
                  if (type) {
                    switch (true) {
                      case type.startsWith('application/json'):
                        input = await request.json();
                        break;
                      case type.startsWith('text'):
                        input = await request.text();
                        break;
                      case type.startsWith('multipart/form-data'):
                        input = await request.formData();
                        break;
                      default:
                        console.error(`Unsupported Content-Type for procedure ${path}: ${type}`);
                        break;
                    }
                  }
                }
              }
            }

            try {
              return toHTTPResponse(await handler({
                input,
                context: this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as any,
              }));
            }
            catch (error) {
              this.emit('error', error as ErrorLike);
              return toHTTPResponse(error);
            }
          };

          // If method is not specified, register route without method restriction
          if (!procedure.http.method) {
            routes[httpPath] = HTTPHandler;
            continue;
          }

          // Register route with method restriction
          if (!routes[httpPath]) routes[httpPath] = {};
          (routes[httpPath] as Record<string, BunRouteHandler>)[procedure.http.method] = HTTPHandler;

          continue;
        }

        for (const [childKey, childValue] of Object.entries(value as ProceduresMap)) {
          const nextPath = path ? `${path}/${childKey}` : childKey;
          stack.push({ path: nextPath, value: childValue as any });
        }
      }
    }

    return { handlers, routes };
  }
}
