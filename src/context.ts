import type { BunRequest, Server, ServerWebSocket } from 'bun';
import type { Promisable } from './types';

export type DeriveRecord = Record<PropertyKey, any>;
export type DeriveValue<C> = | ((context: C) => Promisable<DeriveRecord>) | DeriveRecord;
export type GetDerived<C, T extends DeriveValue<C>> = T extends (...args: any[]) => infer R ? Awaited<R> : T;

export type DeriveUpgradePossibleValue = { data: DeriveRecord } | { headers: Record<string, string> } | { data: DeriveRecord; headers: Record<string, string> };
export type DeriveUpgradeValue<C> = ((context: C) => Promisable<DeriveUpgradePossibleValue>) | DeriveUpgradePossibleValue;
export type GetDerivedUpgradeData<C, T extends DeriveUpgradeValue<C>>
  = T extends (...args: any[]) => infer R
    ? Awaited<R> extends { data: infer D }
      ? D
      : never
    : T extends { data: infer D }
      ? D
      : never;

export type ReplaceSocketData<C, SD> = {
  [K in keyof C]: K extends 'server' ? Server<SD> : K extends 'ws' ? ServerWebSocket<SD> : C[K];
};

export interface BaseContext<SD = unknown> {
  server: Server<SD>;
}

export interface HTTPContext<SD = unknown> extends BaseContext<SD> {
  request: BunRequest;
}

export interface WSContext<SD = unknown> extends BaseContext<SD> {
  ws: ServerWebSocket<SD>;
}

export function isHTTP<SD>(context: BaseContext<SD>): context is HTTPContext<SD> {
  return 'request' in context;
}

export function isWS<SD>(context: BaseContext<SD>): context is WSContext<SD> {
  return 'ws' in context;
}

export type AnyContext<SD> = HTTPContext<SD> | WSContext<SD>;
