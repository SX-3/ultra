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
