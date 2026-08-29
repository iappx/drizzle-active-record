import { Orm, SchemaBuilder, SnakeCaseNamingStrategy, sql, TableRef } from '../../src'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Author, Book, Review } from '../fixtures/testModels'
import { Category } from '../fixtures/treeModels'

// Real drizzle so every fragment is rendered end to end, params included. The pool never connects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
})

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Orm, 'conn').mockReturnValue(db)
})

const toSql = (fragment: { queryChunks: unknown }): { sql: string; params: unknown[] } => {
    const built = db.dialect.sqlToQuery(fragment)
    return { sql: built.sql, params: built.params }
}

describe('TableRef.of / Model.ref — building a reference', () => {
    it('an unaliased ref is the real table', () => {
        expect(TableRef.of(Author).table).toBe((Author as unknown as { meta: { drizzleTable: unknown } }).meta.drizzleTable)
        expect(Author.ref().table).toBe(TableRef.of(Author).table)
    })

    it('{ recursive: true } is the twin', () => {
        expect(Author.ref({ recursive: true }).table)
            .toBe((Author as unknown as { meta: { recursiveTable: unknown } }).meta.recursiveTable)
    })

    it('{ as } aliases the table', () => {
        const ref = Author.ref({ as: 'a2' })
        const text = toSql(sql`select 1 from ${ref.from} where ${ref.column('name')} = 'x'`).sql
        expect(text).toContain('from "authors" "a2"')
        expect(text).toContain('"a2"."name" = ')
    })

    it('column() resolves a property key or a database column name', () => {
        expect(Author.ref().column('name').name).toBe('name')
        expect(Author.ref().column('first_name').name).toBe('first_name')
    })

    it('column() throws naming the model on an unknown key', () => {
        expect(() => Author.ref().column('nope')).toThrow(/Unknown column "nope" on authors/)
    })
})

describe('TableRef.from — the FROM/JOIN element', () => {
    it('unaliased renders as the bare table', () => {
        expect(toSql(sql`select 1 from ${Author.ref().from}`).sql).toContain('from "authors"')
    })

    it('aliased renders as "orig" "alias" — a bare Table chunk would render only the alias', () => {
        const ref = Author.ref({ as: 'a2' })
        expect(toSql(sql`select 1 from ${ref.from}`).sql).toBe('select 1 from "authors" "a2"')
    })
})

describe('TableRef.extra — a qualifier for a name no table owns', () => {
    it('qualifies with the twin on a recursive ref', () => {
        expect(toSql(Author.ref({ recursive: true }).extra('depth')).sql).toBe('"authors__recursive"."depth"')
    })

    it('qualifies with the alias when one is set', () => {
        expect(toSql(Author.ref({ as: 'a2' }).extra('depth')).sql).toBe('"a2"."depth"')
    })
})

describe('TableRef.wrap', () => {
    it('resolves the model from the table when meta is omitted', () => {
        const table = (Author as unknown as { meta: { drizzleTable: never } }).meta.drizzleTable
        expect(TableRef.wrap(table).meta.tableName).toBe('authors')
    })

    it('throws for a table no model owns', () => {
        expect(() => TableRef.wrap({} as never)).toThrow(/no model is registered/)
    })
})

describe('TableRef.existsRelation', () => {
    it('renders the same shape as DBModelQuery.existsRelation — the delegate it replaced', () => {
        const viaRef = toSql(Author.ref().existsRelation({ relation: 'books', where: { title: 'Dune' } }))
        const viaQuery = toSql(Author.query().existsRelation({ model: Book, where: { title: 'Dune' } }))
        expect(viaRef.sql).toBe(viaQuery.sql)
        expect(viaRef.params).toEqual(viaQuery.params)
    })

    it('accepts a bare relation-name string as the shorthand for { as }', () => {
        const text = toSql(Author.ref().existsRelation({ relation: 'books' })).sql
        expect(text).toBe('exists (select 1 from "books" where "books"."author_id" = "authors"."id")')
    })

    it('throws on an unknown relation, naming the source and the target', () => {
        expect(() => Author.ref().existsRelation({ relation: 'nope' })).toThrow(/No relation from authors to nope/)
    })

    it('refuses a belongsToMany hop — no single foreign key to correlate on', () => {
        expect(() => Author.ref().existsRelation({ relation: 'tags' })).toThrow(/belongsToMany relation "tags"/)
    })

    it('a relation path with no steps is rejected', () => {
        expect(() => Author.ref().existsRelation({ relation: [] })).toThrow(/a relation path needs at least one step/)
    })
})

describe('TableRef.notExistsRelation', () => {
    it('wraps existsRelation in NOT, via SqlConditions.not', () => {
        const { sql: text, params } = toSql(Author.ref().notExistsRelation({ relation: 'books', where: { title: 'Dune' } }))
        expect(text).toMatch(/^not \(?exists \(select 1 from "books"/)
        expect(text).toContain('"books"."title" = $1')
        expect(params).toEqual(['Dune'])
    })
})

describe('TableRef.valueOfRelation', () => {
    it('a scalar correlated sub-query, always bounded to one row', () => {
        const { sql: text, params } = toSql(
            Author.ref().valueOfRelation({ relation: 'books', column: 'title', where: { status: 'published' } }),
        )
        expect(text).toBe(
            '(select "title" from "books" where ("books"."author_id" = "authors"."id" and "books"."status" = $1) limit $2)',
        )
        expect(params).toEqual(['published', 1])
    })

    it('respects orderBy — a column name resolves against the last hop', () => {
        const text = toSql(
            Author.ref().valueOfRelation({ relation: 'books', column: 'title', orderBy: [['rating', 'DESC']] }),
        ).sql
        expect(text).toContain('order by "books"."rating" desc')
        expect(text.indexOf('order by')).toBeLessThan(text.indexOf('limit'))
    })
})

describe('TableRef.aggregateOfRelation', () => {
    it('count(*) when no column is given', () => {
        const text = toSql(Book.ref().aggregateOfRelation({ relation: 'reviews', fn: 'count' })).sql
        expect(text).toBe('(select count(*) from "reviews" where "reviews"."book_id" = "books"."id")')
    })

    it('count(column) — drizzle renders a select-list expression unqualified', () => {
        const text = toSql(Book.ref().aggregateOfRelation({ relation: 'reviews', fn: 'count', column: 'id' })).sql
        expect(text).toBe('(select count("id") from "reviews" where "reviews"."book_id" = "books"."id")')
    })

    it('sum/min/max/avg all take a column', () => {
        for (const fn of ['sum', 'min', 'max', 'avg'] as const) {
            const text = toSql(Book.ref().aggregateOfRelation({ relation: 'reviews', fn, column: 'id' })).sql
            expect(text).toContain(`${fn}("id")`)
        }
    })

    it('sum/min/max/avg throw without a column', () => {
        expect(() => Book.ref().aggregateOfRelation({ relation: 'reviews', fn: 'sum' })).toThrow(/needs a \{ column \}/)
    })

    it('cast wraps the whole sub-query — count() returns bigint in Postgres', () => {
        const text = toSql(Book.ref().aggregateOfRelation({ relation: 'reviews', fn: 'count', cast: 'integer' })).sql
        expect(text).toBe('(select count(*) from "reviews" where "reviews"."book_id" = "books"."id")::integer')
    })
})

describe('TableRef.selectFromRelation', () => {
    it('the caller supplies only the selected expression', () => {
        const { sql: text, params } = toSql(
            Author.ref().selectFromRelation({
                relation: 'books',
                where: { status: 'published' },
                select: scope => sql`upper(${scope.ref.column('title')})`,
            }),
        )
        expect(text).toBe(
            '(select upper("title") from "books" where ("books"."author_id" = "authors"."id" and "books"."status" = $1))',
        )
        expect(params).toEqual(['published'])
    })

    it('a where callback gets typed access to the resolved scope', () => {
        const text = toSql(
            Book.ref().selectFromRelation({
                relation: 'reviews',
                where: scope => sql`length(${scope.ref.column('text')}) > 0`,
                select: scope => sql`${scope.column('text')}`,
            }),
        ).sql
        expect(text).toContain('length("reviews"."text") > 0')
    })

    it('limit and orderBy apply when given', () => {
        const text = toSql(
            Author.ref().selectFromRelation({
                relation: 'books',
                orderBy: 'title',
                limit: 3,
                select: scope => sql`${scope.column('title')}`,
            }),
        ).sql
        expect(text).toContain('order by "books"."title" asc')
        expect(text).toContain('limit $1')
    })
})

describe('multi-step relation paths', () => {
    it('each hop joins to the one before it, correlated back to the outer ref', () => {
        const { sql: text } = toSql(
            Author.ref().existsRelation({ relation: ['books', 'reviews'], where: { text: 'great' } }),
        )
        expect(text).toBe(
            'exists (select 1 from "books" inner join "reviews" on "reviews"."book_id" = "books"."id" '
            + 'where ("books"."author_id" = "authors"."id" and "reviews"."text" = $1))',
        )
    })

    it('a table that repeats along the path gets an auto-alias', () => {
        // Author -> books -> author: "authors" appears both as the outer ref and as hop 1
        const text = toSql(
            Author.ref().existsRelation({ relation: ['books', 'author'], where: { active: true } }),
        ).sql
        expect(text).toContain('inner join "authors" "authors__exists" on "authors__exists"."id" = "books"."author_id"')
        expect(text).toContain('"authors__exists"."active" = $1')
        expect(text).toContain('"books"."author_id" = "authors"."id"')
    })

    it('object-form steps disambiguate with { as } and take their own per-hop where', () => {
        const text = toSql(
            Category.ref().existsRelation({ relation: [{ as: 'children' }, { as: 'articles' }] }),
        ).sql
        expect(text).toContain('inner join "articles" on "articles"."category_id" = "categories__exists"."id"')
        expect(text).toContain('"categories__exists"."parent_id" = "categories"."id"')
    })

    it('scope.hop(i) reaches an intermediate step, scope.outer the ref the path started from', () => {
        const author = Author.ref()
        let hop0Table: unknown
        let hop1Table: unknown
        let outerRef: unknown
        author.selectFromRelation({
            relation: ['books', 'reviews'],
            select: scope => {
                hop0Table = scope.hop(0).table
                hop1Table = scope.hop(1).table
                outerRef = scope.outer
                return sql`${scope.ref.column('text')}`
            },
        })
        expect(hop0Table).toBe((Book as unknown as { meta: { drizzleTable: unknown } }).meta.drizzleTable)
        expect(hop1Table).toBe((Review as unknown as { meta: { drizzleTable: unknown } }).meta.drizzleTable)
        expect(outerRef).toBe(author)
    })
})
