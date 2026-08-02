import { TDbDataType } from './metadata'

export class DataType {
    public static readonly INTEGER: TDbDataType = { kind: 'integer' }
    public static readonly BIGINT: TDbDataType = { kind: 'bigint' }
    public static readonly STRING: TDbDataType = { kind: 'string' }
    public static readonly TEXT: TDbDataType = { kind: 'text' }
    public static readonly DATE: TDbDataType = { kind: 'date' }
    public static readonly BOOLEAN: TDbDataType = { kind: 'boolean' }
    public static readonly FLOAT: TDbDataType = { kind: 'float' }
    public static readonly JSON: TDbDataType = { kind: 'json' }
    public static readonly JSONB: TDbDataType = { kind: 'jsonb' }

    public static ENUM(...values: string[]): TDbDataType {
        return { kind: 'enum', enumValues: values }
    }
}
