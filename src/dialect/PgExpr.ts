import { sql, SQL } from 'drizzle-orm'
import { TConditionTarget } from '../query/types'

/** The target types {@link PgExpr.cast} accepts. The name is rendered as a keyword, never bound. */
export type TPgCastType =
    | 'text'
    | 'varchar'
    | 'numeric'
    | 'double precision'
    | 'float'
    | 'int'
    | 'bigint'
    | 'boolean'
    | 'date'
    | 'timestamp'
    | 'json'
    | 'jsonb'

/**
 * PostgreSQL-only expressions: JSON traversal, `cast`, and the two-argument `trunc`. Anything a
 * different dialect also understands lives in `Fn`.
 *
 * Each expression stands in for a column wherever a condition target is taken.
 *
 * @example
 * ```ts
 * const score = PgExpr.cast(PgExpr.jsonText(Author.column('meta'), 'tier'), 'double precision')
 * const authors = await Author.query().where(Op.gt(4).build(score)).getAll()
 * ```
 */
export class PgExpr {
    /** `<source> ->> <key>` — the JSON member as `text`. */
    static jsonText(source: TConditionTarget, key: string | number): SQL<string | null> {
        return sql`${source} ->> ${String(key)}`
    }

    /** `<source> -> <key>` — the JSON member as `json`/`jsonb`, for further traversal. */
    static jsonValue(source: TConditionTarget, key: string | number): SQL {
        return sql`${source} -> ${String(key)}`
    }

    /** `cast(<expr> as <type>)`. */
    static cast<T = unknown>(expr: TConditionTarget, type: TPgCastType): SQL<T> {
        return sql`cast(${expr} as ${sql.raw(type)})` as SQL<T>
    }

    /** `trunc(<expr>, <scale>)` — the two-argument Postgres form. */
    static trunc<T = number>(expr: TConditionTarget, scale: number): SQL<T> {
        return sql`trunc(${expr}, ${scale})` as SQL<T>
    }
}
