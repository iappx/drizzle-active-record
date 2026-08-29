import {
    and as dAnd,
    between as dBetween,
    eq as dEq,
    gt as dGt,
    gte as dGte,
    ilike as dILike,
    inArray,
    isNotNull as dIsNotNull,
    isNull as dIsNull,
    like as dLike,
    lt as dLt,
    lte as dLte,
    ne as dNe,
    not as dNot,
    notIlike as dNotILike,
    notInArray,
    notLike as dNotLike,
    or as dOr,
    SQL,
    sql,
    SQLWrapper,
} from 'drizzle-orm'
import { BoundValue } from '../query/BoundValue'
import { TConditionTarget } from '../query/types'

/**
 * A comparison carried as a value until the column it applies to is known.
 *
 * Every factory returns an operator that `where` turns into SQL against the column it is keyed
 * under, so the same operator serves a model attribute and a raw expression alike.
 *
 * @example
 * ```ts
 * const users = await User.query()
 *     .where({
 *         age: Op.gte(18),
 *         name: Op.iLike('%foo%'),
 *         status: Op.or(Op.eq('draft'), Op.eq('review')),
 *     })
 *     .getAll()
 * ```
 */
export class Op {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private constructor(private readonly builder: (column: any) => SQL) {}

    /**
     * Builds the predicate against `target` — a column, or any expression standing in for one: a
     * JSON extraction, a cast, a correlated aggregate sub-select. An expression carries no
     * bind-parameter typing, which {@link BoundValue} reads off a real column.
     *
     * @example
     * ```ts
     * const condition = Op.is(true).build(query.column('isActive'))
     * ```
     */
    build(target: TConditionTarget): SQL {
        return this.builder(target)
    }

    /** `column = value` — `Op.eq(null)` becomes `column is null`. */
    static eq(value: unknown): Op {
        return new Op(c => (value === null ? dIsNull(c) : dEq(c, BoundValue.for(c, value))))
    }

    /** `column <> value` — `Op.ne(null)` becomes `column is not null`. */
    static ne(value: unknown): Op {
        return new Op(c => (value === null ? dIsNotNull(c) : dNe(c, BoundValue.for(c, value))))
    }

    /** `column > value`. */
    static gt(value: unknown): Op {
        return new Op(c => dGt(c, BoundValue.for(c, value)))
    }

    /** `column >= value`. */
    static gte(value: unknown): Op {
        return new Op(c => dGte(c, BoundValue.for(c, value)))
    }

    /** `column < value`. */
    static lt(value: unknown): Op {
        return new Op(c => dLt(c, BoundValue.for(c, value)))
    }

    /** `column <= value`. */
    static lte(value: unknown): Op {
        return new Op(c => dLte(c, BoundValue.for(c, value)))
    }

    /** `column like pattern` — case-sensitive. */
    static like(value: string): Op {
        return new Op(c => {
            BoundValue.assertDefined(c, value)
            return dLike(c, value)
        })
    }

    /** `column not like pattern` — case-sensitive. */
    static notLike(value: string): Op {
        return new Op(c => {
            BoundValue.assertDefined(c, value)
            return dNotLike(c, value)
        })
    }

    /** `column ilike pattern` — case-insensitive. */
    static iLike(value: string): Op {
        return new Op(c => {
            BoundValue.assertDefined(c, value)
            return dILike(c, value)
        })
    }

    /** `column not ilike pattern` — case-insensitive. */
    static notILike(value: string): Op {
        return new Op(c => {
            BoundValue.assertDefined(c, value)
            return dNotILike(c, value)
        })
    }

    /** `column in (values)` — a list, or a sub-select as `DBModelQuery.asSubQuery()` returns. */
    static in(values: unknown[] | SQLWrapper): Op {
        return new Op(c => (Array.isArray(values)
            ? inArray(c, values.map(v => BoundValue.for(c, v)))
            : inArray(c, values as never)))
    }

    /** `column not in (values)` — takes a list or a sub-select, as `Op.in` does. */
    static notIn(values: unknown[] | SQLWrapper): Op {
        return new Op(c => (Array.isArray(values)
            ? notInArray(c, values.map(v => BoundValue.for(c, v)))
            : notInArray(c, values as never)))
    }

    /** `column between from and to` — both bounds are included. */
    static between(from: unknown, to: unknown): Op {
        return new Op(c => dBetween(c, BoundValue.for(c, from), BoundValue.for(c, to)))
    }

    /** `not (column between from and to)`. */
    static notBetween(from: unknown, to: unknown): Op {
        return new Op(c => dNot(dBetween(c, BoundValue.for(c, from), BoundValue.for(c, to))))
    }

    /** `column is null`. */
    static isNull(): Op {
        return new Op(c => dIsNull(c))
    }

    /** `column is not null`. */
    static isNotNull(): Op {
        return new Op(c => dIsNotNull(c))
    }

    /**
     * SQL's three-valued `IS` predicate: `<column> is true | false | null`.
     *
     * `Op.is(null)` is the same condition as {@link isNull}; `Op.is(true)` is *not* the same as
     * `Op.eq(true)` on a nullable column, because `=` yields NULL (and so filters the row out)
     * where `IS` yields false or true and never NULL.
     */
    static is(value: boolean | null): Op {
        return new Op(c => sql`${c} is ${sql.raw(Op.threeValued(value))}`)
    }

    /**
     * The negated three-valued predicate: `<column> is not true | false | null`.
     *
     * `IS NOT TRUE` matches rows where the column is false **or NULL**, while `Op.ne(true)`
     * (`<> true`) drops the NULL rows silently. `Op.isNot(null)` is the same condition as
     * {@link isNotNull}.
     */
    static isNot(value: boolean | null): Op {
        return new Op(c => sql`${c} is not ${sql.raw(Op.threeValued(value))}`)
    }

    // `IS` takes a keyword, not a bind parameter — `x is $1` is a syntax error.
    private static threeValued(value: boolean | null): string {
        if (value === null) {
            return 'null'
        }
        if (typeof value !== 'boolean') {
            throw new Error(`Op.is / Op.isNot expect true, false or null, got ${String(value)}.`)
        }
        return value ? 'true' : 'false'
    }

    /** Joins operators on one column with `and` — `Op.and(Op.gt(1), Op.lt(10))`. */
    static and(...conditions: Op[]): Op {
        return new Op(c => dAnd(...conditions.map(x => x.build(c))) as SQL)
    }

    /** Joins operators on one column with `or` — `Op.or(Op.eq('draft'), Op.eq('review'))`. */
    static or(...conditions: Op[]): Op {
        return new Op(c => dOr(...conditions.map(x => x.build(c))) as SQL)
    }
}
