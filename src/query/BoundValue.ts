import { sql, SQL } from 'drizzle-orm'

// Column types whose Postgres input function rejects anything that is not a whole number.
const INTEGRAL_COLUMN_TYPES = new Set([
    'PgSmallInt',
    'PgInteger',
    'PgBigInt53',
    'PgBigInt64',
    'PgSmallSerial',
    'PgSerial',
    'PgBigSerial53',
    'PgBigSerial64',
])

/**
 * Prepares a value for binding against the column it is compared against.
 *
 * A fractional number against an integer column is bound as `numeric`, so the comparison yields no
 * rows instead of failing the statement. Every other value passes through unchanged, `NaN` and
 * `Infinity` included. `undefined` is refused.
 *
 * @example
 * ```ts
 * BoundValue.for(Author.column('id'), 1.5)      // sql`1.5::numeric`
 * BoundValue.for(Author.column('id'), 7)        // 7
 * BoundValue.for(Author.column('name'), 'Ann')  // 'Ann'
 * ```
 */
export class BoundValue {
    /**
     * Returns the value to bind against `column`.
     *
     * @throws {Error} When the value is `undefined`
     *
     * @example
     * ```ts
     * const condition = eq(Author.column('id'), BoundValue.for(Author.column('id'), 1.5))
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static for(column: any, value: unknown): unknown | SQL {
        BoundValue.assertDefined(column, value)
        if (typeof value !== 'number' || !Number.isFinite(value) || Number.isSafeInteger(value)) {
            return value
        }
        return INTEGRAL_COLUMN_TYPES.has(column?.columnType) ? sql`${value}::numeric` : value
    }

    /**
     * Throws when the value is `undefined`, naming the column in the message.
     *
     * @throws {Error} `WHERE parameter "<column>" has invalid "undefined" value`
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static assertDefined(column: any, value: unknown): void {
        if (value === undefined) {
            throw new Error(`WHERE parameter "${ column?.name ?? '?' }" has invalid "undefined" value`)
        }
    }
}
