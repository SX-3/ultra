import type { HTTPMethod } from './http';
import type { Middleware } from './middleware';
import type { Promisable } from './types';
import type { StandardSchemaV1 as Schema } from './validation';
import { validate } from './validation';

export interface ProcedureOptions<I, C> {
  input: I;
  context: C;
}

/** Input: I, Output: O, Context: C */
export type ProcedureHandler<I, O, C> = (options: ProcedureOptions<I, C>) => Promisable<O>;

export interface HTTPOptions {
  enabled?: boolean;
  method?: HTTPMethod;
}

export class Procedure<I = unknown, O = unknown, C = unknown> {
  protected readonly middlewares = new Set<Middleware<I, O, C>>();
  protected inputSchema?: Schema<I>;
  protected outputSchema?: Schema<O>;
  protected handlerFunction?: ProcedureHandler<I, O, C>;
  protected httpOptions?: HTTPOptions;

  /** Set procedure input validation schema or type */
  input<const NI>(schema?: Schema<NI>): Procedure<NI, O, C> {
    if (schema) this.inputSchema = schema as any;
    return this as unknown as Procedure<NI, O, C>;
  }

  /** Set procedure output validation schema or type */
  output<const NO>(schema?: Schema<NO>): Procedure<I, NO, C> {
    if (schema) this.outputSchema = schema as any;
    return this as unknown as Procedure<I, NO, C>;
  }

  /** Set procedure handler function */
  handler<const ActualOutput>(
    handler: ProcedureHandler<I, unknown extends O ? ActualOutput : O, C>,
  ): Procedure<I, unknown extends O ? ActualOutput : O, C> {
    this.handlerFunction = handler as any;
    return this as unknown as Procedure<I, unknown extends O ? ActualOutput : O, C>;
  }

  /** Set HTTP options for the procedure */
  http(options?: HTTPOptions | boolean | HTTPMethod): Procedure<I, O, C> {
    switch (typeof options) {
      case 'boolean':
        this.httpOptions = { enabled: options };
        break;
      case 'string':
        this.httpOptions = { enabled: true, method: options };
        break;
      default:
        this.httpOptions = { enabled: true, ...(options ?? {}) };
    }
    return this;
  }

  /** Add middleware to the procedure */
  use(middleware: Middleware<I, O, C>) {
    this.middlewares.add(middleware);
    return this;
  }

  /** Wrap the procedure handler with validation and middleware */
  wrap() {
    if (!this.handlerFunction) throw new Error('Procedure handler is not defined');
    if (!this.inputSchema && !this.outputSchema && !this.middlewares.size) return this.handlerFunction;

    let composed: ProcedureHandler<I, O, C> = this.handlerFunction;

    // Apply input/output validation
    switch (true) {
      case !this.inputSchema && !this.outputSchema:
        break;
      // Validate only input
      case !this.inputSchema: {
        const previous = composed;
        composed = async options => validate(this.outputSchema!, await previous(options));
        break;
      }
      // Validate only output
      case !this.outputSchema: {
        const previous = composed;
        composed = async options => previous({ ...options, input: await validate(this.inputSchema!, options.input) });
        break;
      }
      // Both validation
      default: {
        const previous = composed;
        composed = async (options) => {
          const result = await previous({ ...options, input: await validate(this.inputSchema!, options.input) });
          return validate(this.outputSchema!, result);
        };
      }
    }

    // Apply middleware in reverse order
    if (this.middlewares.size) {
      const middleware = Array.from(this.middlewares);

      for (let i = middleware.length - 1; i >= 0; i--) {
        const mw = middleware[i]!;
        const previous = composed;
        composed = options => mw({ ...options, next: () => previous(options) });
      }
    }

    return composed;
  }

  /** Get procedure metadata information */
  metadata() {
    return {
      http: this.httpOptions,
      middlewares: this.middlewares,
      has: {
        handler: !!this.handlerFunction,
        middleware: this.middlewares.size > 0,
        input: !!this.inputSchema,
        output: !!this.outputSchema,
      },
    };
  }
}
