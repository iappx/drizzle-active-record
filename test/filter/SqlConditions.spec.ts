import { SQL, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SqlConditions } from '../../src'

const dialect = new PgDialect()

const a = sql`a = 1`
const b = sql`b = 2`

describe('SqlConditions', () => {
    it('folds a list into one condition', () => {
        expect(SqlConditions.allOf([a, b])).toBeInstanceOf(SQL)
        expect(SqlConditions.anyOf([a, b])).toBeInstanceOf(SQL)
    })

    it('has nothing to return for an empty list', () => {
        expect(SqlConditions.allOf([])).toBeUndefined()
        expect(SqlConditions.anyOf([])).toBeUndefined()
    })

    it('keeps the narrow SQL type for a literal list — no guard needed at the call site', () => {
        // a compile-time assertion: `SQL | undefined` here would not typecheck
        const both: SQL = SqlConditions.allOf([a, b])
        const either: SQL = SqlConditions.anyOf([a, b])
        expect([both, either].every(c => c instanceof SQL)).toBe(true)
    })

    it('still widens to SQL | undefined for a list built at runtime', () => {
        const conditions: SQL[] = [a]
        const folded: SQL | undefined = SqlConditions.allOf(conditions)
        expect(folded).toBeInstanceOf(SQL)
    })
})

describe('SqlConditions.not', () => {
    it('negates a condition', () => {
        const negated = SqlConditions.not(a)
        expect(negated).toBeInstanceOf(SQL)
    })

    it('is the sole alternative to sql`not ${c}` — same shape, wrapped as a real operator', () => {
        expect(dialect.sqlToQuery(SqlConditions.not(a)).sql).toContain('not')
        expect(dialect.sqlToQuery(SqlConditions.not(a)).sql).toContain('a = 1')
    })

    it('renders exactly like the hand-written sql`not ${c}` it replaces', () => {
        expect(dialect.sqlToQuery(SqlConditions.not(a)).sql).toBe(dialect.sqlToQuery(sql`not ${a}`).sql)
    })
})
