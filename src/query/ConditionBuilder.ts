import { eq, inArray, isNull, SQL } from 'drizzle-orm'
import { Op } from '../filter/Op'
import { BoundValue } from './BoundValue'
import { TWhereInput } from './types'

/**
 * Turns every shape a `where` accepts into flat `SQL` conditions against a drizzle table.
 *
 * @example
 * ```ts
 * ConditionBuilder.fromWhere(authorsTable, { name: 'Ann', rating: Op.gt(4) })
 * ```
 */
export class ConditionBuilder {
    /**
     * Resolves a `where` input against `table` into conditions to be ANDed together.
     *
     * `{ column: value }` becomes one condition per key, a ready `SQL` is taken as is, a list is
     * flattened, and `undefined` yields an empty array.
     *
     * @example
     * ```ts
     * ConditionBuilder.fromWhere(booksTable, [{ isPublished: true }, gt(booksTable.rating, 4)])
     * ConditionBuilder.fromWhere(booksTable, undefined) // []
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static fromWhere(table: any, where: TWhereInput): SQL[] {
        if (!where) {
            return []
        }
        if (where instanceof SQL) {
            return [where]
        }
        if (Array.isArray(where)) {
            return where.flatMap(item => ConditionBuilder.fromWhere(table, item))
        }
        return Object.entries(where).map(([key, value]) => ConditionBuilder.fromValue(table[key], value))
    }

    /**
     * Builds the condition one value means against one column.
     *
     * An {@link Op} builds itself, an array becomes `IN`, `null` becomes `IS NULL`, and anything
     * else becomes equality.
     *
     * @example
     * ```ts
     * ConditionBuilder.fromValue(booksTable.rating, Op.gte(4)) // "rating" >= 4
     * ConditionBuilder.fromValue(booksTable.id, [1, 2, 3])     // "id" in (1, 2, 3)
     * ConditionBuilder.fromValue(booksTable.deletedAt, null)   // "deleted_at" is null
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static fromValue(column: any, value: unknown): SQL {
        if (value instanceof Op) {
            return value.build(column)
        }
        if (Array.isArray(value)) {
            return inArray(column, value.map(v => BoundValue.for(column, v)))
        }
        if (value === null) {
            return isNull(column)
        }
        return eq(column, BoundValue.for(column, value))
    }
}
