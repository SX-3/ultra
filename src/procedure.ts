import type { BaseContext } from './context';
import type { HTTPMethod } from './http';
import type { Middleware } from './middleware';
import type { Promisable } from './types';
import type { StandardSchemaV1 as Schema } from './validation';
import { validate } from './validation';

export interface ProcedureOptions<I, C> {
  input: I;
  context: C;
}

export type ProcedureHandler<I, O, C extends BaseContext> = (options: ProcedureOptions<I, C>) => Promisable<O>;

export interface HTTPOptions {
  enabled?: boolean;
  method?: HTTPMethod;
}

export class Procedure<I = unknown, O = unknown, C extends BaseContext = BaseContext> {
  protected inputSchema?: Schema<I>;
  protected outputSchema?: Schema<O>;
  protected handlerFunction?: ProcedureHandler<I, O, C>;
  protected middleware = new Set<Middleware<I, O, C>>();
  protected httpOptions?: HTTPOptions;

  input<const NI>(schema?: Schema<NI>): Procedure<NI, O, C> {
    if (schema) this.inputSchema = schema as any;
    return this as unknown as Procedure<NI, O, C>;
  }

  output<const NO>(schema?: Schema<NO>): Procedure<I, NO, C> {
    if (schema) this.outputSchema = schema as any;
    return this as unknown as Procedure<I, NO, C>;
  }

  handler<const ActualOutput>(
    handler: ProcedureHandler<I, unknown extends O ? ActualOutput : O, C>,
  ): Procedure<I, unknown extends O ? ActualOutput : O, C> {
    this.handlerFunction = handler as any;
    return this as unknown as Procedure<I, unknown extends O ? ActualOutput : O, C>;
  }

  http(options?: HTTPOptions): Procedure<I, O, C> {
    this.httpOptions = { enabled: true, ...options };
    return this;
  }

  use(middleware: Middleware<I, O, C>): Procedure<I, O, C> {
    this.middleware.add(middleware);
    return this;
  }

  wrap() {
    if (!this.handlerFunction) throw new Error('Procedure handler is not defined');
    if (!this.inputSchema && !this.outputSchema && !this.middleware.size) return this.handlerFunction;

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
    if (this.middleware.size) {
      const middleware = Array.from(this.middleware);

      for (let i = middleware.length - 1; i >= 0; i--) {
        const mw = middleware[i]!;
        const previous = composed;
        composed = options => mw({ ...options, next: () => previous(options) });
      }
    }

    return composed;
  }

  getInfo() {
    return {
      http: this.httpOptions,
      hasInput: !!this.inputSchema,
      hasOutput: !!this.outputSchema,
    };
  }
}
