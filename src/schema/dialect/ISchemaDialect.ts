import type { Table as TDrizzleTable } from 'drizzle-orm'
import { TColumnMeta } from '../../types/metadata'

// drizzle column builders are dialect-specific and heavily overloaded; the schema
// layer only chains modifiers on them, so they cross this seam untyped
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TColumnBuilder = any

export interface ISchemaDialect {
    createTable(tableName: string, columns: Record<string, TColumnBuilder>): TDrizzleTable

    mapColumn(column: TColumnMeta): TColumnBuilder
}
