import {
    bigint,
    boolean,
    customType,
    doublePrecision,
    integer,
    json,
    jsonb,
    numeric,
    pgTable,
    smallint,
    text,
    time,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import { ISchemaDialect, TColumnBuilder } from './ISchemaDialect'
import { TColumnMeta, TDbDataType } from '../../types/metadata'

// a column whose database type the driver passes through untouched (ltree, citext, inet, ...)
const passThrough = (sqlType: string) => customType<{ data: string; driverData: string }>({
    dataType: () => sqlType,
})

export class PgSchemaDialect implements ISchemaDialect {
    public static readonly DefaultStringLength = 255

    public createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable {
        return pgTable(tableName, columns) as unknown as TDrizzleTable
    }

    public mapColumn(column: TColumnMeta): TColumnBuilder {
        // resolved by SchemaBuilder (explicit name or naming strategy) before the dialect sees it
        const name = column.columnName as string
        return this.mapDataType(name, column.dataType)
    }

    private mapDataType(name: string, dataType: TDbDataType): TColumnBuilder {
        switch (dataType.kind) {
            case 'integer':
                return integer(name)
            case 'smallint':
                return smallint(name)
            case 'bigint':
                // 'bigint' reads back a JS BigInt; every other value keeps the default JS number
                return bigint(name, { mode: dataType.mode === 'bigint' ? 'bigint' : 'number' })
            case 'float':
            case 'double':
                return doublePrecision(name)
            case 'decimal':
                // read back as a JS number by default: application code does arithmetic on these.
                // DataType.DECIMAL(p, s, { mode: 'string' }) keeps the value exact instead
                return numeric(name, {
                    precision: dataType.precision,
                    scale: dataType.scale,
                    mode: dataType.mode ?? 'number',
                })
            case 'boolean':
                return boolean(name)
            case 'date':
                return timestamp(name, { withTimezone: true, mode: 'date' })
            case 'time':
                return time(name)
            case 'uuid':
                return uuid(name)
            case 'text':
                return text(name)
            case 'json':
                return json(name)
            case 'jsonb':
                return jsonb(name)
            case 'enum':
                return text(name)
            case 'array':
                if (!dataType.itemType) {
                    throw new Error(`Column "${name}" is declared as ARRAY without an item type`)
                }
                return this.mapDataType(name, dataType.itemType).array()
            case 'custom':
                if (!dataType.sqlType) {
                    throw new Error(`Column "${name}" is declared as CUSTOM without a database type`)
                }
                return passThrough(dataType.sqlType)(name)
            case 'string':
            default:
                return varchar(name, { length: dataType.size ?? PgSchemaDialect.DefaultStringLength })
        }
    }
}
