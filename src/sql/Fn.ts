import { sql, SQL } from 'drizzle-orm'
import { TConditionTarget } from '../query/types'

/**
 * Standard SQL functions Drizzle does not export as expression builders. Dialect-neutral —
 * Postgres-only expressions live in `PgExpr`.
 *
 * @example
 * ```ts
 * const rating = Fn.coalesce(Book.column('rating'), 0)
 * const books = await Book.query().where(Op.gte(4).build(rating)).getAll()
 * ```
 */
export class Fn {
    /** `coalesce(<expr>, <fallback>, ...)` — the fallbacks are bound as parameters. */
    static coalesce<T = unknown>(expr: TConditionTarget, ...fallbacks: unknown[]): SQL<T> {
        const parts = fallbacks.map(value => (value instanceof SQL ? value : sql`${value}`))
        return sql`coalesce(${sql.join([sql`${expr}`, ...parts], sql`, `)})` as SQL<T>
    }
}
