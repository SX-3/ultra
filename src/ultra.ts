import type { BunRequest, ErrorLike, Server, ServerWebSocket } from 'bun';
import type { BaseContext, DeriveUpgradeValue, DeriveValue, ExtractDerive, ExtractDeriveUpgradeData, RebindSocketData } from './context';
import type { BunRouteHandler, BunRoutes } from './http';
import type { Middleware } from './middleware';
import type { ProcedureHandler, ProcedureOptions } from './procedure';
import type { Payload } from './rpc';
import type { StandardSchemaV1 as Schema } from './validation';
import { serve } from 'bun';
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

export type InputFactory<C> = <I>(schema?: Schema<I>) => Procedure<I, unknown, C>;
export type ProcedureMapInitializer<R extends ProceduresMap, C> = (input: InputFactory<C>) => R;

export interface UltraOptions {
  http?: {
    enableByDefault?: boolean;
  };
}

export class Ultra<
  Procedures extends ProceduresMap = ProceduresMap,
  SocketData = unknown,
  Context extends BaseContext<SocketData> = BaseContext<SocketData>,
> {
  protected readonly initializers = new Set<ProcedureMapInitializer<any, Context>>();
  protected readonly handlers = new Map<string, ProcedureHandler<any, any, Context>>();
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
  routes<const P extends ProceduresMap>(initializer: ProcedureMapInitializer<P, Context>): Ultra<Procedures & P, SocketData, Context> {
    this.initializers.add(initializer);
    return this;
  }

  /** Register middleware or another Ultra instance */
  use<
    const PluginProcedures extends ProceduresMap,
    const PluginSocketData,
    const PluginContext extends BaseContext<PluginSocketData>,
  >(entity: Middleware<any, any, Context> | Ultra<PluginProcedures, PluginSocketData, PluginContext>,
  ): Ultra<
    Procedures & PluginProcedures,
    SocketData & PluginSocketData,
    RebindSocketData<Context, SocketData & PluginSocketData> & RebindSocketData<PluginContext, SocketData & PluginSocketData>
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

  /** Extends  context values for every request with provided values */
  derive<const D extends DeriveValue<Context>>(derive: D): Ultra<Procedures, SocketData, Context & ExtractDerive<Context, D>> {
    this.derived.add(derive);
    return this as any;
  }

  deriveUpgrade<const D extends DeriveUpgradeValue<Context>>(derive: D): Ultra<
    Procedures,
    SocketData & ExtractDeriveUpgradeData<Context, D>,
    RebindSocketData<Context, SocketData & ExtractDeriveUpgradeData<Context, D>>
  > {
    this.derivedUpgrade.add(derive);
    return this as any;
  }

  start(options?: StartOptions<SocketData>) {
    if (this.server) {
      console.warn('Server is already running');
      return this.server;
    }

    const procedures = this.buildProcedures();

    const notFoundHandler = this.wrapHandler(() => new Response('Not Found', { status: 404 }));

    this.server = serve<SocketData>({

      ...(this.httpEnabled && {
        routes: {
          // Procedure routes
          ...this.buildRoutes(procedures),
          '/ws': async (request, server) => {
            this.emit('http:request', request, server);
            if (!this.derivedUpgrade.size) {
              // @ts-expect-error Bun types
              if (!server.upgrade(request)) {
                return new Response('WebSocket upgrade failed', { status: 500 });
              };
              return;
            }

            const context = this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as Context;
            // @ts-expect-error Bun types
            if (!server.upgrade(request, await this.enrichUpgrade(context))) {
              return new Response('WebSocket upgrade failed', { status: 500 });
            };
          },

          // Not found handler
          '/*': async (request, server) => {
            this.emit('http:request', request, server);
            return notFoundHandler({
              input: null,
              context: this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as Context,
            });
          },
        },
      }),

      websocket: {
        data: {} as SocketData,
        open: (ws) => { this.emit('ws:open', ws); },
        close: (ws, code, reason) => { this.emit('ws:close', ws, code, reason); },
        message: (ws, message) => {
          this.emit('ws:message', ws, message);
          if (typeof message !== 'string') return;
          const data = JSON.parse(message);
          if (isRPC(data)) this.handleRPC(ws, data);
        },
      },

      error: (error) => {
        this.emit('unhandled:error', error);
        console.error('Unhandled server error:', error);
        return new Response('Internal Server Error', { status: 500 });
      },

      ...options,
    } as Bun.Serve.Options<SocketData>);

    this.emit('server:started', this.server);
    return this.server;
  }

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

  protected async handleRPC(ws: ServerWebSocket<SocketData>, payload: Payload) {
    const handler = this.handlers.get(payload.method);
    // Not found procedure
    if (!handler) {
      ws.send(`{"id": "${payload.id}", "error": {"code": 404, "message": "Not found"}}`);
      return;
    };

    try {
      ws.send(toRPCResponse(payload.id, await handler({
        input: payload.params,
        context: await this.enrichContext({ server: this.server!, ws }),
      })));
    }
    catch (error) {
      this.emit('error', error as ErrorLike);
      ws.send(toRPCResponse(payload.id, error));
    }
  }

  /** Enrich context with derived values */
  protected async enrichContext(context: BaseContext<SocketData>): Promise<Context> {
    // ? Derive sequentially to allow using previous derived values
    for (const derive of this.derived) {
      Object.assign(
        context,
        typeof derive === 'function' ? await derive(context as Context) : derive,
      );
    }

    return context as Context;
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
    module.initializers.forEach(init => this.initializers.add(init));
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
  protected wrapHandler(handler: ProcedureHandler<any, any, any>): ProcedureHandler<any, any, any> {
    if (!this.middlewares.size) return handler;
    const middlewares = Array.from(this.middlewares);
    return async (options: ProcedureOptions<any, Context>) => {
      let idx = 0;
      const next = () => {
        if (idx === middlewares.length) return handler(options);
        return middlewares[idx++]!({ ...options, next });
      };
      return next();
    };
  }

  /** Build flat map from procedures tree and write handles map */
  protected buildProcedures() {
    const procedures = new Map<string, Procedure<any, any, Context>>();

    const inputFactory: InputFactory<Context> = <I>(schema?: Schema<I>) => {
      const procedure = new Procedure<I, unknown, Context>();
      if (schema) procedure.input(schema);
      if (this.options.http?.enableByDefault) procedure.http();
      return procedure;
    };

    for (const initializer of this.initializers) {
      const map = initializer(inputFactory);
      const stack: Array<{ path: string; value: Procedure<any, any, Context> | ProceduresMap }> = [];

      for (const [key, value] of Object.entries(map)) {
        stack.push({ path: key, value: value as any });
      }

      while (stack.length) {
        const { path, value } = stack.pop()!;

        if (value instanceof Procedure) {
          if (procedures.has(path)) throw new Error(`Procedure "${path}" already exists`);

          if (!this.httpEnabled && value.metadata()?.http?.enabled) this.httpEnabled = true;

          procedures.set(path, value as Procedure<any, any, Context>);
          this.handlers.set(path, this.wrapHandler(value.wrap()));
          continue;
        }

        for (const [childKey, childValue] of Object.entries(value as ProceduresMap)) {
          const nextPath = path ? `${path}/${childKey}` : childKey;
          stack.push({ path: nextPath, value: childValue as any });
        }
      }
    }

    return procedures;
  }

  /** Build Bun native HTTP routes */
  protected buildRoutes(procedures: Map<string, Procedure<any, any, Context>>) {
    const routes: BunRoutes = {};
    for (const [path, procedure] of procedures) {
      const metadata = procedure.metadata();
      // Skip if HTTP is disabled
      if (!metadata.http?.enabled) continue;

      const httpPath = `/${path}`;

      const handler = this.handlers.get(path);
      if (!handler) throw new Error(`Handler for procedure at path "${path}" is not defined`);

      // ! Runtime logic edits may performance hit. Avoid adding logic that can be resolved at startup.
      const httpHandler: BunRouteHandler = async (request: BunRequest, server: Server<SocketData>) => {
        this.emit('http:request', request, server);

        let input: any = request.body;
        const context = this.derived.size ? await this.enrichContext({ server, request }) : { server, request } as Context;

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
            context,
          }));
        }
        catch (error) {
          this.emit('error', error as ErrorLike);
          return toHTTPResponse(error);
        }
      };

      // If method is not specified, register route without method restriction
      if (!metadata.http.method) {
        routes[httpPath] = httpHandler;
        continue;
      }

      // Register route with method restriction
      if (!routes[httpPath]) routes[httpPath] = {};
      (routes[httpPath] as Record<string, BunRouteHandler>)[metadata.http.method] = httpHandler;
    }

    return routes;
  }
}
