import type { BaseContext } from './context';
import type { ProcedureHandler, ProcedureOptions } from './procedure';

export interface MiddlewareOptions<I, O, C extends BaseContext = BaseContext> extends ProcedureOptions<I, C> {
  next: () => ReturnType<ProcedureHandler<I, O, C>>;
}

export type Middleware<I, O, C extends BaseContext> = (options: MiddlewareOptions<I, O, C>) => Awaited<ReturnType<ProcedureHandler<I, O, C>>>;
