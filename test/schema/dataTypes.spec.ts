import { DataType, ModelRegistry, SchemaBuilder } from '../../src'
import { TypedEntity } from '../fixtures/typeModels'

beforeAll(() => {
    SchemaBuilder.build()
})

type TInspectableColumn = {
    getSQLType(): string
    dataType: string
    mapFromDriverValue(value: unknown): unknown
}

const columnOf = (property: string): TInspectableColumn => {
    const table = ModelRegistry.require(TypedEntity).drizzleTable as unknown as Record<string, TInspectableColumn>
    return table[property]
}

const sqlTypeOf = (property: string): string => columnOf(property).getSQLType()

describe('column types emitted by the postgres dialect', () => {
    it.each([
        ['id', 'bigint'],
        ['small', 'smallint'],
        ['whole', 'integer'],
        ['ratio', 'double precision'],
        ['longText', 'text'],
        ['guid', 'uuid'],
        ['enabled', 'boolean'],
        ['payload', 'jsonb'],
    ])('%s -> %s', (property, expected) => {
        expect(sqlTypeOf(property)).toBe(expected)
    })

    it('DECIMAL carries precision and scale', () => {
        expect(sqlTypeOf('amount')).toBe('numeric(15, 2)')
    })

    it('DECIMAL without arguments stays unsized', () => {
        expect(sqlTypeOf('unsizedAmount')).toBe('numeric')
    })

    it('DECIMAL keeps precision and scale when a mode is passed alongside them', () => {
        expect(sqlTypeOf('exactAmount')).toBe('numeric(15, 4)')
    })

    it('DECIMAL({ mode }) alone stays unsized', () => {
        expect(sqlTypeOf('exactUnsizedAmount')).toBe('numeric')
    })

    it('TIME maps to a time column', () => {
        expect(sqlTypeOf('opensAt')).toContain('time')
    })

    it('DATE maps to a timestamp with time zone', () => {
        expect(sqlTypeOf('happenedAt')).toContain('timestamp')
    })

    it('STRING falls back to the default length', () => {
        expect(sqlTypeOf('defaultText')).toBe('varchar(255)')
    })

    it('STRING(n) is sized by the caller', () => {
        expect(sqlTypeOf('shortText')).toBe('varchar(64)')
    })

    it('ARRAY wraps its item type', () => {
        expect(sqlTypeOf('tags')).toBe('varchar(255)[]')
        expect(sqlTypeOf('codes')).toBe('integer[]')
    })

    it('CUSTOM passes the database type through untouched', () => {
        expect(sqlTypeOf('path')).toBe('ltree')
    })
})

describe('read-back mode', () => {
    it('DECIMAL stays a JS number by default', () => {
        expect(columnOf('amount').dataType).toBe('number')
        expect(columnOf('unsizedAmount').dataType).toBe('number')
        expect(columnOf('amount').mapFromDriverValue('10.25')).toBe(10.25)
    })

    it('DECIMAL(p, s, { mode: "string" }) hands the value back verbatim', () => {
        expect(columnOf('exactAmount').dataType).toBe('string')
        // the point of the mode: a value a JS number cannot hold exactly survives untouched
        expect(columnOf('exactAmount').mapFromDriverValue('12345678901234.5678')).toBe('12345678901234.5678')
    })

    it('DECIMAL({ mode: "string" }) applies the mode without precision or scale', () => {
        expect(columnOf('exactUnsizedAmount').dataType).toBe('string')
    })

    it('DECIMAL accepts the bigint mode drizzle supports', () => {
        expect(columnOf('hugeAmount').dataType).toBe('bigint')
    })

    it('BIGINT stays a JS number by default', () => {
        expect(columnOf('id').dataType).toBe('number')
    })

    it('BIGINT({ mode: "bigint" }) reads back a JS BigInt', () => {
        expect(columnOf('bigCounter').dataType).toBe('bigint')
        // beyond Number.MAX_SAFE_INTEGER: a JS number would round it, a BigInt does not
        expect(columnOf('bigCounter').mapFromDriverValue('9007199254740993'))
            .toBe(BigInt('9007199254740993'))
    })
})

describe('DataType', () => {
    it('STRING is usable both as a constant and as a factory', () => {
        expect(DataType.STRING.kind).toBe('string')
        expect(DataType.STRING(64)).toEqual({ kind: 'string', size: 64 })
    })

    // a sized type is a function, and every function already owns a `length` (its arity):
    // the size must not be stored under that name or a bare STRING would read back as 1
    it('a bare sized type reports no size of its own', () => {
        expect(DataType.STRING.size).toBeUndefined()
    })

    it('BIGINT is usable both as a constant and as a factory', () => {
        expect(DataType.BIGINT.kind).toBe('bigint')
        expect(DataType.BIGINT.mode).toBeUndefined()
        expect(DataType.BIGINT({ mode: 'bigint' })).toEqual({ kind: 'bigint', mode: 'bigint' })
    })

    it('DECIMAL keeps its argument forms apart', () => {
        expect(DataType.DECIMAL()).toEqual({ kind: 'decimal' })
        expect(DataType.DECIMAL(15, 4)).toEqual({ kind: 'decimal', precision: 15, scale: 4 })
        expect(DataType.DECIMAL(15, 4, { mode: 'string' })).toEqual({
            kind: 'decimal', precision: 15, scale: 4, mode: 'string',
        })
        expect(DataType.DECIMAL({ mode: 'string' })).toEqual({ kind: 'decimal', mode: 'string' })
    })

    it('ARRAY without an item type is rejected when the schema is built', () => {
        expect(() => new (require('../../src').PgSchemaDialect)().mapColumn({
            propertyKey: 'broken',
            columnName: 'broken',
            dataType: { kind: 'array' },
            options: {},
        })).toThrow(/ARRAY without an item type/)
    })

    it('CUSTOM without a database type is rejected when the schema is built', () => {
        expect(() => new (require('../../src').PgSchemaDialect)().mapColumn({
            propertyKey: 'broken',
            columnName: 'broken',
            dataType: { kind: 'custom' },
            options: {},
        })).toThrow(/CUSTOM without a database type/)
    })
})
