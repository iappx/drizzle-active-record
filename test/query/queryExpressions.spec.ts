import { Fn, Op, Orm, PgExpr, SchemaBuilder, SnakeCaseNamingStrategy, sql } from '../../src'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { Author, Book } from '../fixtures/testModels'

// Real drizzle, as in existsRelation.spec: an expression only counts if it survives into the
// emitted statement with its parameters intact. The pool never connects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any
const dialect = new PgDialect()

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
})

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Orm, 'conn').mockReturnValue(db)
})

describe('exists() — the EXISTS written from the target side', () => {
    it('renders the same condition as the inline existsRelation form', () => {
        const inline = Author.query()
        const fromInline = inline.where(inline.existsRelation({ model: Book, where: { title: 'Dune' } })).toSQL().sql
        const fromTarget = Author.query().where(Book.query().where({ title: 'Dune' }).exists()).toSQL().sql
        expect(fromTarget).toBe(fromInline)
    })

    it('correlates to the outer row and binds the conditions', () => {
        const { sql: statement, params } = Author.query()
            .where(Book.query().where({ title: 'Dune' }).exists())
            .toSQL()
        expect(statement).toContain('exists')
        expect(statement).toContain('"books"."author_id" = "authors"."id"')
        expect(params).toContain('Dune')
    })

    it('accepts several where calls and a raw fragment among them', () => {
        const statement = Author.query()
            .where(Book.query().where({ title: 'Dune' }).where(sql`${Book.column('rating')} > 4`).exists())
            .toSQL().sql
        expect(statement).toContain('"books"."title"')
        expect(statement).toContain('"books"."rating" > 4')
    })

    it('notExists() negates it', () => {
        const statement = Author.query().where(Book.query().where({ title: 'Dune' }).notExists()).toSQL().sql
        expect(statement).toContain('not exists')
    })

    it('refuses a query that also selects, orders or limits, instead of dropping that silently', () => {
        expect(() => Book.query().select(['id']).exists()).toThrow(/exists\(\) takes conditions only/)
        expect(() => Book.query().limit(1).exists()).toThrow(/limit\/offset/)
        expect(() => Book.query().orderBy('title').exists()).toThrow(/orderBy/)
        expect(() => Book.query().where({ id: 1 }).orWhere({ id: 2 }).exists()).toThrow(/orWhere/)
    })
})

describe('selectExcept', () => {
    it('selects every column but the named ones', () => {
        const statement = Author.query().selectExcept(['bio', 'meta']).toSQL().sql
        expect(statement).toContain('"name"')
        expect(statement).not.toContain('"bio"')
        expect(statement).not.toContain('"meta"')
    })

    it('an unknown column name throws instead of silently narrowing the row', () => {
        expect(() => Author.query().selectExcept(['nope'])).toThrow(/"nope" is not a column of authors/)
    })
})

describe('TableRef.aggregate — an aggregate over the ref\'s own table', () => {
    it('builds a scalar sub-select filtered by its own conditions', () => {
        const expr = Book.ref().aggregate({ fn: 'min', column: 'rating', where: { id: [1, 2] } })
        const { sql: statement, params } = dialect.sqlToQuery(expr)
        expect(statement).toMatch(/select min\("rating"\) from "books"/i)
        expect(statement).toContain('in (')
        expect(params).toEqual([1, 2])
    })

    it('count needs no column', () => {
        const { sql: statement } = dialect.sqlToQuery(Book.ref().aggregate({ fn: 'count' }))
        expect(statement).toMatch(/count\(\*\)/i)
    })

    it('is usable as the left side of an Op', () => {
        const expr = Book.ref().aggregate({ fn: 'min', column: 'rating' })
        const { sql: statement, params } = dialect.sqlToQuery(Op.gt(4).build(expr))
        expect(statement).toContain('>')
        expect(params).toEqual([4])
    })
})

describe('PgExpr / Fn', () => {
    it('jsonText renders the ->> extraction with the key bound', () => {
        const { sql: statement, params } = dialect.sqlToQuery(PgExpr.jsonText(Author.column('meta'), 'tier'))
        expect(statement).toContain('->>')
        expect(params).toEqual(['tier'])
    })

    it('cast renders the keyword form, not a parameter', () => {
        const { sql: statement, params } = dialect.sqlToQuery(PgExpr.cast(Author.column('age'), 'text'))
        expect(statement).toMatch(/cast\(.* as text\)/i)
        expect(params).toEqual([])
    })

    it('trunc keeps the scale', () => {
        const { sql: statement, params } = dialect.sqlToQuery(PgExpr.trunc(Book.column('rating'), 2))
        expect(statement).toMatch(/trunc\(/i)
        expect(params).toEqual([2])
    })

    it('coalesce binds its fallbacks', () => {
        const { sql: statement, params } = dialect.sqlToQuery(Fn.coalesce(Book.column('rating'), 0))
        expect(statement).toMatch(/coalesce\(/i)
        expect(params).toEqual([0])
    })

    it('composes into the plan-property shape the application builds by hand today', () => {
        const expr = PgExpr.cast(Fn.coalesce(PgExpr.jsonText(Author.column('meta'), 7), '0'), 'double precision')
        const { sql: statement, params } = dialect.sqlToQuery(expr)
        expect(statement).toMatch(/cast\(coalesce\(.*->>.*\) as double precision\)/i)
        expect(params).toEqual(['7', '0'])
    })
})
