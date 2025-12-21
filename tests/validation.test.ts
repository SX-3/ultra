import type { StandardSchemaV1 } from '../src/validation';
import { describe, expect, it } from 'bun:test';
import { ValidationError } from '../src/error';
import { validate } from '../src/validation';

function makeSchema<I, O>(validateFn: StandardSchemaV1<I, O>['~standard']['validate']): StandardSchemaV1<I, O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'unit-test',
      validate: validateFn,
    },
  };
}

describe('validate', () => {
  it('returns validated output when schema succeeds', async () => {
    const schema = makeSchema<string, number>(value => ({ value: Number(value) + 1 }));

    await expect(validate(schema, '2')).resolves.toBe(3);
  });

  it('handles async validators', async () => {
    const schema = makeSchema<number, string>(async value => ({ value: `n:${value}` }));

    await expect(validate(schema, 7)).resolves.toBe('n:7');
  });

  it('throws ValidationError with formatted issues when validation fails', async () => {
    const schema = makeSchema<string, never>(() => ({ issues: [{ message: 'bad input', path: ['field'] }] }));
    const validation = validate(schema, 'oops');

    await expect(validation).rejects.toThrow(ValidationError);
    await expect(validation).rejects.toThrow('[\n  {\n    "message": "bad input",\n    "path": [\n      "field"\n    ]\n  }\n]');
  });
});
