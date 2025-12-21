import type { BaseContext } from '../src/context';
import type { StandardSchemaV1 } from '../src/validation';
import { describe, expect, it } from 'bun:test';
import { Procedure } from '../src/procedure';

function makeSchema<T>(validateFn: (value: T) => { value: T } | { issues: any[] } | Promise<{ value: T } | { issues: any[] }>): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'unit-test',
      validate: (value: unknown) => validateFn(value as T),
    },
  };
}

const ctx: BaseContext = { server: {} as any, request: {} as any };

describe('Procedure.wrap', () => {
  it('throws when handler is missing', () => {
    const procedure = new Procedure();
    expect(() => procedure.wrap()).toThrow('Procedure handler is not defined');
  });

  it('returns the original handler when nothing to wrap', () => {
    const handler = () => 'ok';
    const procedure = new Procedure().handler(handler);

    expect(procedure.wrap()).toBe(handler);
  });

  it('validates input before calling handler', async () => {
    const inputSchema = makeSchema<string>(value => ({ value: `validated-${value}` }));
    const procedure = new Procedure<string, string>().input(inputSchema).handler(({ input }) => input);

    const result = await procedure.wrap()({ input: 'raw', context: ctx });
    expect(result).toBe('validated-raw');
  });

  it('validates output after handler returns', async () => {
    const outputSchema = makeSchema<string>(value => ({ value: `${value}-checked` }));
    const procedure = new Procedure<string, string>().output(outputSchema).handler(() => 'result');

    const result = await procedure.wrap()({ input: 'ignored', context: ctx });
    expect(result).toBe('result-checked');
  });

  it('validates both input and output', async () => {
    const inputSchema = makeSchema<string>(value => ({ value: `trimmed-${value}` }));
    const outputSchema = makeSchema<string>(value => ({ value: `${value}-ok` }));
    const procedure = new Procedure<string, string>()
      .input(inputSchema)
      .output(outputSchema)
      .handler(({ input }) => input);

    const result = await procedure.wrap()({ input: 'abc', context: ctx });
    expect(result).toBe('trimmed-abc-ok');
  });

  it('applies middleware in reverse registration order', async () => {
    const calls: string[] = [];
    const procedure = new Procedure<string, string>().handler(({ input }) => {
      calls.push('handler');
      return input;
    });

    procedure.use(async ({ next }) => {
      calls.push('mw1-start');
      const result = await next();
      calls.push('mw1-end');
      return result;
    });

    procedure.use(async ({ next }) => {
      calls.push('mw2-start');
      const result = await next();
      calls.push('mw2-end');
      return result;
    });

    const result = await procedure.wrap()({ input: 'data', context: ctx });

    expect(result).toBe('data');
    expect(calls).toEqual([
      'mw1-start',
      'mw2-start',
      'handler',
      'mw2-end',
      'mw1-end',
    ]);
  });
});

describe('Procedure.info', () => {
  it('returns http settings and schema flags', () => {
    const inputSchema = makeSchema<string>(value => ({ value }));
    const outputSchema = makeSchema<string>(value => ({ value }));

    const info = new Procedure<string, string>()
      .input(inputSchema)
      .output(outputSchema)
      .http({ method: 'POST', path: '/submit' })
      .handler(({ input }) => input)
      .getInfo();

    expect(info).toEqual({
      http: { enabled: true, method: 'POST', path: '/submit' },
      hasInput: true,
      hasOutput: true,
    });
  });
});
