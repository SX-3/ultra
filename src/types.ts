export type Promisable<T> = T | Promise<T>;

export type JSONPrimitive = string | number | boolean | null;
export interface JSONObject { [key: string]: JSONValue }
export type JSONArray = JSONValue[];
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;

export type DeepReadonly<T> = T extends Array<infer R>
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : Readonly<T>;

export type GetReturn<T> = T extends (...args: any[]) => infer R ? Awaited<R> : T;
export type ResetRecursion<T> = T & {};
// type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...number[]];
// export type Simplify<T, Depth extends number = 5> = Depth extends 0 ? T : T extends object ? { [K in keyof T]: Simplify<T[K], Prev[Depth]> } & {} : T;
export type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } & {} : T;
// export type Lazy<T> = T | (() => T);
// export type Branded<T, B> = T & { __brand?: B };
