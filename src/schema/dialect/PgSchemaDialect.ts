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
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import { ISchemaDialect, TColumnBuilder } from './ISchemaDialect'
import { TColumnMeta, TDbDataType } from '../../types/metadata'

const passThrough = (sqlType: string) => customType<{ data: string; driverData: string }>({
    dataType: () => sqlType,
})

// drizzle's own `timestamp({ mode: 'date' })` calls `value.toISOString()`, which throws while the
// statement is built for a string or an epoch number; a value that parses to none is passed through
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timestampValue = customType<{ data: Date; driverData: any }>({
    dataType: () => 'timestamp with time zone',
    toDriver: (value: unknown): unknown => {
        if (value instanceof Date) {
            return value.toISOString()
        }
        if (typeof value === 'number' || typeof value === 'string') {
            const parsed = new Date(value)
            return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
        }
        return value
    },
    // the driver hands back a Date when node-postgres parses the type itself and a string when it
    // does not; both have to end up as a Date, because that is what the date kind promises
    fromDriver: (value: unknown): Date => (value instanceof Date ? value : new Date(value as string)),
})

// a relation loaded through the relational query builder arrives inside a JSON row, where Postgres writes
// `numeric` as a JSON number: `1000.00` comes back as 1000, and digits past a double's precision are gone
const scaledDecimalString = (precision: number | undefined, scale: number) => customType<{
    data: string
    driverData: string | number
}>({
    dataType: () => (precision === undefined ? 'numeric' : `numeric(${precision}, ${scale})`),
    fromDriver: (value: string | number): string => (typeof value === 'number' ? value.toFixed(scale) : value),
})

/**
 * The PostgreSQL schema dialect: builds `pgTable`s and `pg-core` column builders from model metadata.
 *
 * It is the dialect `SchemaBuilder` uses unless another one is installed with
 * `SchemaBuilder.setDialect(...)`.
 *
 * @example
 * ```ts
 * SchemaBuilder.setDialect(new PgSchemaDialect())
 * SchemaBuilder.build()
 * ```
 */
export class PgSchemaDialect implements ISchemaDialect {
    /** Length given to a `STRING` column that declares no size. */
    public static readonly DefaultStringLength = 255

    /**
     * Builds the `pgTable` for a model.
     *
     * @param columns Builders keyed by property key, as returned by {@link PgSchemaDialect.mapColumn}
     */
    public createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable {
        return pgTable(tableName, columns) as unknown as TDrizzleTable
    }

    /**
     * Builds the `pg-core` column builder for a column, from its declared data type.
     *
     * A `DATE` column accepts a `Date`, an ISO or SQL string and an epoch number, and always reads
     * back as a `Date`. A `DECIMAL` in `string` mode with a scale reads back with that scale, from a
     * plain row and from a relation's JSON row alike. An `ARRAY` without an item type and a `CUSTOM`
     * without a database type throw.
     *
     * @throws {Error} When the data type is `array` without `itemType`, or `custom` without `sqlType`
     */
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
                return bigint(name, { mode: dataType.mode === 'bigint' ? 'bigint' : 'number' })
            case 'float':
            case 'double':
                return doublePrecision(name)
            case 'decimal':
                if (dataType.mode === 'string' && dataType.scale !== undefined) {
                    return scaledDecimalString(dataType.precision, dataType.scale)(name)
                }
                return numeric(name, {
                    precision: dataType.precision,
                    scale: dataType.scale,
                    mode: dataType.mode ?? 'number',
                })
            case 'boolean':
                return boolean(name)
            case 'date':
                return timestampValue(name)
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
