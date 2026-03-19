import { fromJsonSchema } from '../standard-schema-adapter';
import { internal } from '../constants';
import type { SchemaType } from '../base';

/**
 * Helper to get the internal definition type of a schema.
 */
function defType(schema: SchemaType): string {
  return (schema as any)[internal].definition.type;
}

describe('fromJsonSchema', () => {
  // -------------------------------------------------------
  // Basic types
  // -------------------------------------------------------

  describe('basic types', () => {
    test('string', () => {
      const schema = fromJsonSchema({ type: 'string', description: 'a name' });
      expect(defType(schema)).toBe('string');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('string');
      expect(json.description).toBe('a name');
    });

    test('string with pattern and format', () => {
      const schema = fromJsonSchema({
        type: 'string',
        description: 'email',
        pattern: '^[a-z]+$',
        format: 'email',
      });
      expect(defType(schema)).toBe('string');
      const json = schema.toJsonSchema();
      expect(json.pattern).toBe('^[a-z]+$');
      expect(json.format).toBe('email');
    });

    test('number', () => {
      const schema = fromJsonSchema({ type: 'number', description: 'a count' });
      expect(defType(schema)).toBe('number');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('number');
    });

    test('number with constraints', () => {
      const schema = fromJsonSchema({
        type: 'number',
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
        multipleOf: 5,
      });
      expect(defType(schema)).toBe('number');
      const json = schema.toJsonSchema();
      expect(json.minimum).toBe(0);
      expect(json.maximum).toBe(100);
      expect(json.exclusiveMinimum).toBe(-1);
      expect(json.exclusiveMaximum).toBe(101);
      expect(json.multipleOf).toBe(5);
    });

    test('integer', () => {
      const schema = fromJsonSchema({ type: 'integer', description: 'an int' });
      expect(defType(schema)).toBe('integer');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('integer');
    });

    test('boolean', () => {
      const schema = fromJsonSchema({ type: 'boolean', description: 'a flag' });
      expect(defType(schema)).toBe('boolean');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('boolean');
    });

    test('null', () => {
      const schema = fromJsonSchema({ type: 'null' });
      expect(defType(schema)).toBe('null');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('null');
    });
  });

  // -------------------------------------------------------
  // Object
  // -------------------------------------------------------

  describe('object', () => {
    test('with properties and required', () => {
      const schema = fromJsonSchema({
        type: 'object',
        description: 'a person',
        properties: {
          name: { type: 'string', description: 'name' },
          age: { type: 'number', description: 'age' },
        },
        required: ['name', 'age'],
      });
      expect(defType(schema)).toBe('object');
      const json = schema.toJsonSchema();
      expect(json.type).toBe('object');
      expect(json.required).toEqual(['name', 'age']);
    });

    test('with no properties', () => {
      const schema = fromJsonSchema({
        type: 'object',
        description: 'empty',
      });
      expect(defType(schema)).toBe('object');
    });

    test('streaming mode produces streaming object', () => {
      const schema = fromJsonSchema(
        {
          type: 'object',
          description: 'streamed',
          properties: {
            text: { type: 'string', description: 'text' },
          },
        },
        { streaming: true },
      );
      expect(defType(schema)).toBe('object');
      expect((schema as any)[internal].definition.streaming).toBe(true);
    });
  });

  // -------------------------------------------------------
  // Array
  // -------------------------------------------------------

  describe('array', () => {
    test('with items', () => {
      const schema = fromJsonSchema({
        type: 'array',
        description: 'a list',
        items: { type: 'number', description: 'num' },
      });
      expect(defType(schema)).toBe('array');
    });

    test('with minItems and maxItems', () => {
      const schema = fromJsonSchema({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      });
      expect(defType(schema)).toBe('array');
    });

    test('without items defaults to string item', () => {
      const schema = fromJsonSchema({
        type: 'array',
        description: 'generic list',
      });
      expect(defType(schema)).toBe('array');
    });

    test('streaming mode produces streaming array', () => {
      const schema = fromJsonSchema(
        {
          type: 'array',
          description: 'streamed list',
          items: { type: 'number' },
        },
        { streaming: true },
      );
      expect(defType(schema)).toBe('array');
      expect((schema as any)[internal].definition.streaming).toBe(true);
    });
  });

  // -------------------------------------------------------
  // Enum
  // -------------------------------------------------------

  describe('enum', () => {
    test('string enum', () => {
      const schema = fromJsonSchema({
        enum: ['red', 'green', 'blue'],
        description: 'color',
      });
      expect(defType(schema)).toBe('enum');
      const json = schema.toJsonSchema();
      expect(json.enum).toEqual(['red', 'green', 'blue']);
    });

    test('mixed enum filters to strings only', () => {
      const schema = fromJsonSchema({
        enum: ['a', 42, true, 'b'],
        description: 'mixed',
      });
      expect(defType(schema)).toBe('enum');
      const json = schema.toJsonSchema();
      expect(json.enum).toEqual(['a', 'b']);
    });
  });

  // -------------------------------------------------------
  // Const / Literal
  // -------------------------------------------------------

  describe('const / literal', () => {
    test('string const produces literal', () => {
      const schema = fromJsonSchema({
        const: 'fixed',
        description: 'a literal',
      });
      expect(defType(schema)).toBe('literal');
      const json = schema.toJsonSchema();
      expect(json.const).toBe('fixed');
    });

    test('non-string const falls through to type handling', () => {
      const schema = fromJsonSchema({
        const: 42,
        type: 'number',
        description: 'num const',
      });
      // Non-string const falls through to number type handling
      expect(defType(schema)).toBe('number');
    });
  });

  // -------------------------------------------------------
  // anyOf / oneOf unions
  // -------------------------------------------------------

  describe('anyOf / oneOf unions', () => {
    test('anyOf creates union', () => {
      const schema = fromJsonSchema({
        anyOf: [
          { type: 'string', description: 'str' },
          { type: 'number', description: 'num' },
        ],
      });
      expect(defType(schema)).toBe('any-of');
    });

    test('oneOf creates union', () => {
      const schema = fromJsonSchema({
        oneOf: [
          { type: 'boolean', description: 'bool' },
          { type: 'null' },
        ],
      });
      expect(defType(schema)).toBe('any-of');
    });

    test('type array creates union', () => {
      const schema = fromJsonSchema({
        type: ['string', 'null'],
        description: 'nullable string',
      });
      expect(defType(schema)).toBe('any-of');
    });
  });

  // -------------------------------------------------------
  // Unknown / missing type
  // -------------------------------------------------------

  describe('unknown / missing type', () => {
    test('unknown type logs warning and falls back to string', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const schema = fromJsonSchema({ type: 'custom' as any, description: 'weird' });

      expect(defType(schema)).toBe('string');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('Unknown or unsupported JSON Schema type');
      expect(warnSpy.mock.calls[0][0]).toContain('"custom"');

      warnSpy.mockRestore();
    });

    test('undefined type without properties logs warning and falls back to string', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const schema = fromJsonSchema({ description: 'no type no props' });

      expect(defType(schema)).toBe('string');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    test('missing type with properties is treated as object (Fix 3)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const schema = fromJsonSchema({
        description: 'implicit object',
        properties: {
          name: { type: 'string', description: 'name' },
        },
      });

      expect(defType(schema)).toBe('object');
      // No warning should be logged since we recognized it as an object
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    test('missing type with properties in streaming mode produces streaming object', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const schema = fromJsonSchema(
        {
          description: 'implicit streaming object',
          properties: {
            text: { type: 'string', description: 'text' },
          },
        },
        { streaming: true },
      );

      expect(defType(schema)).toBe('object');
      expect((schema as any)[internal].definition.streaming).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------
  // Nested / complex schemas
  // -------------------------------------------------------

  describe('nested schemas', () => {
    test('object with nested array and union', () => {
      const schema = fromJsonSchema({
        type: 'object',
        description: 'root',
        properties: {
          items: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string', description: 'str' },
                { type: 'number', description: 'num' },
              ],
            },
          },
        },
      });
      expect(defType(schema)).toBe('object');
    });
  });
});
