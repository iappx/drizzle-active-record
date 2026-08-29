import { Orm, SchemaBuilder, SnakeCaseNamingStrategy, sql } from '../../src'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Author, Book, Review } from '../fixtures/testModels'
import { Person } from '../fixtures/multiRefModels'

// Real drizzle so the include is rendered end to end: a raw `SQL` in an include's `where` only
// counts if it survives into the emitted statement. The pool never connects.
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

describe('raw include — where accepts a SQL fragment', () => {
    // drizzle renders a to-many branch as a lateral sub-select aliased "<parent>_<relation>";
    // the fragment's columns follow that alias, exactly as an object-form condition does
    it('carries the fragment into the relation branch', () => {
        const statement = Author.query()
            .include({ model: Book, where: sql`lower(${Book.column('title')}) like 'warm%'` })
            .toSQL().sql
        expect(statement).toContain(`lower("authors_books"."title") like 'warm%'`)
    })

    it('still accepts the plain object form', () => {
        const statement = Author.query().include({ model: Book, where: { title: 'X' } }).toSQL().sql
        expect(statement).toContain('"authors_books"."title" = $1')
    })

    it('mixes with nested includes', () => {
        const statement = Author.query()
            .include({
                model: Book,
                where: sql`${Book.column('rating')} > 4`,
                include: [{ model: Review }],
            })
            .toSQL().sql
        expect(statement).toContain('"authors_books"."rating" > 4')
        expect(statement).toContain('"authors_books_reviews"."book_id" = "authors_books"."id"')
    })
})

describe('raw include — SQL fragment under { required: true }', () => {
    it('lands inside the WHERE EXISTS sub-query, not on the parent', () => {
        const statement = Author.query()
            .include({ model: Book, where: sql`${Book.column('rating')} > 4`, required: true })
            .toSQL().sql
        expect(statement).toContain('exists')
        expect(statement).toContain('"books"."rating" > 4')
    })

    it('a self-referencing include re-points the fragment at the aliased child', () => {
        // without the alias mapping the condition would filter the parent row instead of the child
        const statement = Person.query()
            .include({ as: 'children', where: sql`length(${Person.column('name')}) > 3`, required: true })
            .toSQL().sql
        expect(statement).toContain('length("people__exists"."name") > 3')
        expect(statement).not.toContain('length("people"."name") > 3')
    })

    it('the EXISTS still correlates on the relation column', () => {
        const statement = Person.query()
            .include({ as: 'children', where: sql`length(${Person.column('name')}) > 3`, required: true })
            .toSQL().sql
        expect(statement).toContain('"people__exists"."parent_id" = "people"."id"')
    })

    // The query builder aliases every nested relation table after the path that reaches it, so a
    // `required` include one level down has to correlate to that alias. Correlating to the real
    // table name puts a table in the condition that the sub-select's FROM never names, and
    // Postgres rejects the whole statement with "invalid reference to FROM-clause entry".
    it('a nested required include correlates to the parent branch alias, not the real table', () => {
        const statement = Author.query()
            .include({ model: Book, include: [{ model: Review, required: true }] })
            .toSQL().sql
        expect(statement).toContain('"reviews"."book_id" = "authors_books"."id"')
        expect(statement).not.toContain('"reviews"."book_id" = "books"."id"')
    })

    it('a top-level required include still correlates to the root table', () => {
        const statement = Author.query().include({ model: Book, required: true }).toSQL().sql
        expect(statement).toContain('"books"."author_id" = "authors"."id"')
    })

    // Same defect through the other door: the branch is a query built on its own, so at the time
    // its `required` include is attached it has no idea it will end up nested.
    it('includeQueryable carries the alias down when the branch is itself nested', () => {
        const branch = Book.query().includeQueryable(Review.query(), { required: true })
        const statement = Author.query().includeQueryable(branch).toSQL().sql
        expect(statement).toContain('"reviews"."book_id" = "authors_books"."id"')
        expect(statement).not.toContain('"reviews"."book_id" = "books"."id"')
    })

    it('includeQueryable at the top level still correlates to the root table', () => {
        const statement = Author.query().includeQueryable(Book.query(), { required: true }).toSQL().sql
        expect(statement).toContain('"books"."author_id" = "authors"."id"')
    })
})

describe('Model.column — static access to the drizzle column', () => {
    it('returns the column for a property key', () => {
        expect(Author.column('name').name).toBe('name')
        expect(Author.column('firstName').name).toBe('first_name')
    })

    it('accepts the database column name too', () => {
        expect(Author.column('first_name').name).toBe('first_name')
    })

    it('yields the same column the query-level column() does', () => {
        expect(Author.column('name')).toBe(Author.query().column('name'))
    })

    it('composes into a raw sql fragment usable as a condition', () => {
        const statement = Author.query()
            .where(sql`lower(${Author.column('name')}) = 'x'`)
            .toSQL().sql
        expect(statement).toContain(`lower("authors"."name") = 'x'`)
    })

    it('throws naming the model and the known columns for an unknown name', () => {
        expect(() => Author.column('nope')).toThrow(/Unknown column "nope" on Author/)
        expect(() => Author.column('nope')).toThrow(/Known columns:/)
    })
})
