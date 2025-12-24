import type { BunRequest, Server, ServerWebSocket } from 'bun';
import type { Promisable } from './types';

export type DeriveFunction<C> = (context: C) => Promisable<Record<PropertyKey, any>>;
export type DeriveValue<C> = DeriveFunction<C> | Record<PropertyKey, any>;
export type ExtractDerive<C, T extends DeriveValue<C>> = T extends (...args: any[]) => any ? Awaited<ReturnType<T>> : T;

export type DeriveUpgradePossibleValue = { data: Record<PropertyKey, any> } | { headers: Record<string, string> } | { data: Record<PropertyKey, any>; headers: Record<string, string> };
export type DeriveUpgradeFunction<C> = (context: C) => Promisable<DeriveUpgradePossibleValue>;
export type DeriveUpgradeValue<C> = DeriveUpgradeFunction<C> | DeriveUpgradePossibleValue;
export type ExtractDeriveUpgradeData<C, T extends DeriveUpgradeValue<C>> = T extends (...args: any[]) => any ? Awaited<ReturnType<T>> extends { data: infer D } ? D : never : T extends { data: infer D } ? D : never;
export type RebindSocketData<C, SD> = C extends HTTPContext<any> ? HTTPContext<SD> & Omit<C, keyof HTTPContext<any>> : C extends WSContext<any> ? WSContext<SD> & Omit<C, keyof WSContext<any>> : C extends BaseContext<any> ? BaseContext<SD> & Omit<C, keyof BaseContext<any>> : C;

export interface HTTPContext<SD = unknown> {
  server: Server<SD>;
  request: BunRequest;
}

export interface WSContext<SD = unknown> {
  server: Server<SD>;
  ws: ServerWebSocket<SD>;
}

export type BaseContext<SD = unknown> = HTTPContext<SD> | WSContext<SD>;

export function isHTTP<SD>(context: BaseContext<SD>): context is HTTPContext<SD> {
  return 'request' in context;
}

export function isWS<SD>(context: BaseContext<SD>): context is WSContext<SD> {
  return 'ws' in context;
}
