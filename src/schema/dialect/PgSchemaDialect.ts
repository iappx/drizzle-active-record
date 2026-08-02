import {
    bigint,
    boolean,
    doublePrecision,
    integer,
    json,
    jsonb,
    pgTable,
    text,
    timestamp,
    varchar,
} from 'drizzle-orm/pg-core'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import { ISchemaDialect, TColumnBuilder } from './ISchemaDialect'
import { TColumnMeta } from '../../types/metadata'

export class PgSchemaDialect implements ISchemaDialect {
    public static readonly DefaultStringLength = 255

    public createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable {
        return pgTable(tableName, columns) as unknown as TDrizzleTable
    }

    public mapColumn(column: TColumnMeta): TColumnBuilder {
        // resolved by SchemaBuilder (explicit name or naming strategy) before the dialect sees it
        const name = column.columnName as string
        switch (column.dataType.kind) {
            case 'integer':
                return integer(name)
            case 'bigint':
                return bigint(name, { mode: 'number' })
            case 'float':
                return doublePrecision(name)
            case 'boolean':
                return boolean(name)
            case 'date':
                return timestamp(name, { withTimezone: true, mode: 'date' })
            case 'text':
                return text(name)
            case 'json':
                return json(name)
            case 'jsonb':
                return jsonb(name)
            case 'enum':
                return text(name)
            case 'string':
            default:
                return varchar(name, { length: PgSchemaDialect.DefaultStringLength })
        }
    }
}
