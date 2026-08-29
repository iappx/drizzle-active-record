import { TBigIntMode, TDbDataType, TDecimalMode } from './metadata'

/**
 * A data type that is usable both as a constant and as a factory taking a size.
 *
 * @example
 * ```ts
 * @NamedColumn(DataType.STRING, 'first_name')     // varchar(255)
 * @NamedColumn(DataType.STRING(64), 'short_code') // varchar(64)
 * ```
 */
export type TSizedDataType = TDbDataType & ((size: number) => TDbDataType)

/** The read-back mode passed to a type whose only option is that mode. */
export type TModeOptions<TMode extends TDecimalMode> = { mode: TMode }

/**
 * A data type that is usable both as a constant and as a factory taking a read-back mode.
 *
 * @example
 * ```ts
 * @NamedColumn(DataType.BIGINT, 'id')                            // read back as a JS number
 * @NamedColumn(DataType.BIGINT({ mode: 'bigint' }), 'event_no')  // read back as a JS BigInt
 * ```
 */
export type TModedDataType<TMode extends TDecimalMode> = TDbDataType & ((options: TModeOptions<TMode>) => TDbDataType)

/** Options accepted by `DataType.DECIMAL` alongside precision and scale. */
export type TDecimalOptions = { mode?: TDecimalMode }

const sized = (kind: TDbDataType['kind']): TSizedDataType =>
    Object.assign((size: number): TDbDataType => ({ kind, size }), { kind } as TDbDataType)

const moded = <TMode extends TDecimalMode>(kind: TDbDataType['kind']): TModedDataType<TMode> =>
    Object.assign((options: TModeOptions<TMode>): TDbDataType => ({ kind, mode: options.mode }), { kind } as TDbDataType)

/**
 * The column types a model declares its columns with.
 *
 * Every member is a description of a column, not a column builder: the dialect turns it into the
 * database type when the schema is built.
 *
 * @example
 * ```ts
 * @Table('authors')
 * class Author extends QueryableModel<Author> {
 *     @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
 *     id: number
 *
 *     @NamedColumn(DataType.STRING(64), 'name')
 *     name: string
 * }
 * ```
 */
export class DataType {
    /** `integer`. */
    public static readonly INTEGER: TDbDataType = { kind: 'integer' }

    /** `smallint`. */
    public static readonly SMALLINT: TDbDataType = { kind: 'smallint' }

    /** `bigint`, read back as a JS number unless `BIGINT({ mode: 'bigint' })` asks for a BigInt. */
    public static readonly BIGINT: TModedDataType<TBigIntMode> = moded<TBigIntMode>('bigint')

    /** `double precision`. */
    public static readonly FLOAT: TDbDataType = { kind: 'float' }

    /** `double precision`. */
    public static readonly DOUBLE: TDbDataType = { kind: 'double' }

    /** `text`, of unlimited length. */
    public static readonly TEXT: TDbDataType = { kind: 'text' }

    /** `timestamp with time zone`, read back as a `Date`. */
    public static readonly DATE: TDbDataType = { kind: 'date' }

    /** `time`, read back as a string. */
    public static readonly TIME: TDbDataType = { kind: 'time' }

    /** `boolean`. */
    public static readonly BOOLEAN: TDbDataType = { kind: 'boolean' }

    /** `uuid`. */
    public static readonly UUID: TDbDataType = { kind: 'uuid' }

    /** `json`. */
    public static readonly JSON: TDbDataType = { kind: 'json' }

    /** `jsonb`. */
    public static readonly JSONB: TDbDataType = { kind: 'jsonb' }

    /** `varchar`, 255 characters long unless called with a size: `STRING(64)` is `varchar(64)`. */
    public static readonly STRING: TSizedDataType = sized('string')

    /**
     * Describes a `numeric` column.
     *
     * `mode` decides how the driver hands the value back: `'number'` (the default) is convenient for
     * arithmetic, `'string'` keeps the decimal exact, `'bigint'` reads it back as a JS BigInt. Precision and
     * scale are optional on their own, and the column stays unsized without them.
     *
     * @example
     * ```ts
     * @NamedColumn(DataType.DECIMAL({ mode: 'string' }), 'balance') // numeric, '0.00000001'
     * balance: string
     * ```
     */
    public static DECIMAL(options?: TDecimalOptions): TDbDataType
    /**
     * Describes a `numeric(precision, scale)` column.
     *
     * @example
     * ```ts
     * @NamedColumn(DataType.DECIMAL(15, 2), 'rating')                    // numeric(15, 2), 4.25
     * rating: number
     *
     * @NamedColumn(DataType.DECIMAL(18, 8, { mode: 'string' }), 'amount') // numeric(18, 8), exact
     * amount: string
     * ```
     */
    public static DECIMAL(precision?: number, scale?: number, options?: TDecimalOptions): TDbDataType
    public static DECIMAL(
        precisionOrOptions?: number | TDecimalOptions,
        scale?: number,
        options?: TDecimalOptions,
    ): TDbDataType {
        if (typeof precisionOrOptions === 'object') {
            return { kind: 'decimal', mode: precisionOrOptions.mode }
        }
        return { kind: 'decimal', precision: precisionOrOptions, scale, mode: options?.mode }
    }

    /**
     * Describes a column holding one of a fixed set of strings.
     *
     * The column itself is `text`; the accepted values are kept on the metadata rather than emitted as a
     * Postgres enum type.
     *
     * @example
     * ```ts
     * @NamedColumn(DataType.ENUM('draft', 'published'), 'status')
     * status: string
     * ```
     */
    public static ENUM(...values: string[]): TDbDataType {
        return { kind: 'enum', enumValues: values }
    }

    /**
     * Describes an array column over another type.
     *
     * The item type may be any other `DataType`, and the column's database type is that type followed by
     * `[]`. The schema build fails if the item type is missing.
     *
     * @example
     * ```ts
     * @NamedColumn(DataType.ARRAY(DataType.STRING), 'tags')  // varchar(255)[]
     * tags: string[]
     *
     * @NamedColumn(DataType.ARRAY(DataType.INTEGER), 'codes') // integer[]
     * codes: number[]
     * ```
     */
    public static ARRAY(itemType: TDbDataType): TDbDataType {
        return { kind: 'array', itemType }
    }

    /**
     * Describes a column by its database type verbatim, for types the dialect has no builder for.
     *
     * The value crosses the driver untouched in both directions, so querying such a column is done with raw
     * `sql` fragments.
     *
     * @example
     * ```ts
     * @NamedColumn(DataType.CUSTOM('ltree'), 'path')
     * path: string
     * ```
     */
    public static CUSTOM(sqlType: string): TDbDataType {
        return { kind: 'custom', sqlType }
    }
}
