import type { Table as TDrizzleTable } from 'drizzle-orm'
import { TColumnMeta } from '../../types/metadata'

/** A drizzle column builder, with the modifiers (`primaryKey()`, `notNull()`, ...) the schema layer chains on it. */
// column builders are dialect-specific and heavily overloaded, so they cross this seam untyped
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TColumnBuilder = any

/**
 * Translates model metadata into the drizzle tables and column builders of one database dialect.
 *
 * `PgSchemaDialect` is the built-in implementation; an alternative is installed with
 * `SchemaBuilder.setDialect(...)` before the schema is built.
 *
 * @example
 * ```ts
 * export class MySchemaDialect implements ISchemaDialect {
 *     public createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable {
 *         return mysqlTable(tableName, columns) as unknown as TDrizzleTable
 *     }
 *
 *     public mapColumn(column: TColumnMeta): TColumnBuilder {
 *         return varchar(column.columnName as string, { length: 255 })
 *     }
 * }
 * ```
 */
export interface ISchemaDialect {
    /**
     * Builds the drizzle table for a model.
     *
     * @param columns Builders keyed by property key, as returned by {@link ISchemaDialect.mapColumn}
     */
    createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable

    /**
     * Builds the column builder for a single column, from its declared data type.
     *
     * The column name is already resolved when the dialect sees it. Modifiers such as `primaryKey()`
     * and `notNull()` are applied by `SchemaBuilder` afterwards.
     */
    mapColumn(column: TColumnMeta): TColumnBuilder
}
