import { TBigIntMode, TDbDataType, TDecimalMode } from './metadata'

// `DataType.STRING` and `DataType.STRING(64)` are both valid: the constant doubles as a factory
export type TSizedDataType = TDbDataType & ((size: number) => TDbDataType)

// same trick for types whose only option is the read-back mode: `DataType.BIGINT` and
// `DataType.BIGINT({ mode: 'bigint' })` are both valid
export type TModeOptions<TMode extends TDecimalMode> = { mode: TMode }
export type TModedDataType<TMode extends TDecimalMode> = TDbDataType & ((options: TModeOptions<TMode>) => TDbDataType)

export type TDecimalOptions = { mode?: TDecimalMode }

const sized = (kind: TDbDataType['kind']): TSizedDataType =>
    Object.assign((size: number): TDbDataType => ({ kind, size }), { kind } as TDbDataType)

const moded = <TMode extends TDecimalMode>(kind: TDbDataType['kind']): TModedDataType<TMode> =>
    Object.assign((options: TModeOptions<TMode>): TDbDataType => ({ kind, mode: options.mode }), { kind } as TDbDataType)

export class DataType {
    public static readonly INTEGER: TDbDataType = { kind: 'integer' }
    public static readonly SMALLINT: TDbDataType = { kind: 'smallint' }
    public static readonly BIGINT: TModedDataType<TBigIntMode> = moded<TBigIntMode>('bigint')
    public static readonly FLOAT: TDbDataType = { kind: 'float' }
    public static readonly DOUBLE: TDbDataType = { kind: 'double' }
    public static readonly TEXT: TDbDataType = { kind: 'text' }
    public static readonly DATE: TDbDataType = { kind: 'date' }
    public static readonly TIME: TDbDataType = { kind: 'time' }
    public static readonly BOOLEAN: TDbDataType = { kind: 'boolean' }
    public static readonly UUID: TDbDataType = { kind: 'uuid' }
    public static readonly JSON: TDbDataType = { kind: 'json' }
    public static readonly JSONB: TDbDataType = { kind: 'jsonb' }

    public static readonly STRING: TSizedDataType = sized('string')

    // `mode` decides how the driver hands the value back: 'number' (the default) is convenient
    // for arithmetic, 'string' is the only mode that keeps a decimal exact — use it for money
    public static DECIMAL(options?: TDecimalOptions): TDbDataType
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

    public static ENUM(...values: string[]): TDbDataType {
        return { kind: 'enum', enumValues: values }
    }

    public static ARRAY(itemType: TDbDataType): TDbDataType {
        return { kind: 'array', itemType }
    }

    // escape hatch for database types the dialect has no builder for: DataType.CUSTOM('ltree')
    public static CUSTOM(sqlType: string): TDbDataType {
        return { kind: 'custom', sqlType }
    }
}
