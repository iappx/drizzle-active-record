import { and, not, or, SQL } from 'drizzle-orm'

/**
 * `and` / `or` over a list of raw conditions, folded into a single `SQL` value.
 *
 * An empty list folds to `undefined`, which every `where` reads as "no condition". A list written
 * out literally keeps the narrow `SQL` type, so it needs no guard where an `SQL` is required.
 */
export class SqlConditions {
    /**
     * ANDs a list written out literally into one condition.
     *
     * @example
     * ```ts
     * query.where(SqlConditions.anyOf([
     *     SqlConditions.allOf([sql`a = 1`, sql`b = 2`]),
     *     query.existsRelation({ model: Post }),
     * ]))
     * ```
     */
    public static allOf(conditions: [SQL, ...SQL[]]): SQL
    /** ANDs a list built at runtime; an empty list yields `undefined`. */
    public static allOf(conditions: SQL[]): SQL | undefined
    public static allOf(conditions: SQL[]): SQL | undefined {
        return conditions.length ? (and(...conditions) as SQL) : undefined
    }

    /**
     * ORs a list written out literally into one condition.
     *
     * @example
     * ```ts
     * const anyMatch: SQL = SqlConditions.anyOf([sql`a = 1`, sql`b = 2`])
     * ```
     */
    public static anyOf(conditions: [SQL, ...SQL[]]): SQL
    /** ORs a list built at runtime; an empty list yields `undefined`. */
    public static anyOf(conditions: SQL[]): SQL | undefined
    public static anyOf(conditions: SQL[]): SQL | undefined {
        return conditions.length ? (or(...conditions) as SQL) : undefined
    }

    /** `not (<condition>)`. */
    public static not(condition: SQL): SQL {
        return not(condition) as SQL
    }
}
