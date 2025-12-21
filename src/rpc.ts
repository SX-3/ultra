import type { JSONValue } from './types';

export interface ErrorResult {
  id: string;
  error: {
    code: number;
    message: string;
  };
}

export interface SuccessResult {
  id: string;
  result: JSONValue;
}

export type Result = ErrorResult | SuccessResult;

export interface Payload {
  id: string;
  method: string;
  params?: JSONValue;
}

export function isRPC(value: any): value is Payload {
  return !!value && typeof value === 'object' && 'id' in value && 'method' in value;
}
