// type DecrementDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// type Prefix<P extends string, K> = P extends '' ? `${K & string}` : `${P}/${K & string}`;

export type Promisable<T> = T | Promise<T>;
export type GetReturn<T> = T extends (...args: any[]) => infer R ? Awaited<R> : T;
export type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } & {} : T;

export type JSONPrimitive = string | number | boolean | null;
export interface JSONObject { [key: string]: JSONValue }
export type JSONArray = JSONValue[];
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;

export type DeepReadonly<T> = T extends Array<infer R>
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : Readonly<T>;

// export type GetProceduresPaths<T, P extends string = '', Depth extends number = 5> = [Depth] extends [never] ? never : {
//   [K in keyof T]: T[K] extends ProceduresMap ? GetProceduresPaths<T[K], Prefix<P, K>, DecrementDepth[Depth]> : Prefix<P, K>
// }[keyof T];

// export type PathValue<T, P, S extends string = '/'>
//   = P extends `${infer Key}${S}${infer Rest}`
//     ? Key extends keyof T
//       ? PathValue<T[Key], Rest>
//       : never
//     : P extends keyof T
//       ? T[P]
//       : never;

// export type FlatProcedures<T> = {
//   [P in GetProceduresPaths<T>]: PathValue<T, P>
// };

// export type Lazy<T> = T | (() => T);
// export type Branded<T, B> = T & { __brand?: B };
// export type ResetRecursion<T> = T & {};
