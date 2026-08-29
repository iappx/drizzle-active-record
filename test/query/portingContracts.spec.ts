import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Author, AuthorTag, Book, Tag } from '../fixtures/testModels'
import { Op, Orm, SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'

// A real drizzle instance so every statement below is rendered by drizzle itself. The pool never
// connects; only the generated SQL is asserted.
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

describe('query.column() resolves and reports like its siblings', () => {
    it('accepts the database column name, not only the property key', () => {
        expect(Author.query().column('first_name')).toBe(Author.column('firstName'))
        expect(Author.query().column('firstName')).toBe(Author.column('firstName'))
    })

    it('names the model and its columns instead of returning undefined', () => {
        expect(() => Author.query().column('nope')).toThrow(/Unknown column "nope" on authors/)
        expect(() => Author.query().column('nope')).toThrow(/Known columns: /)
    })

    it('.groupBy() still drops an unresolvable column silently', () => {
        expect(() => Author.query().groupBy('nope')).not.toThrow()
    })
})

describe('a required include nested under another one filters the outermost parent', () => {
    it('the grandchild condition reaches the top-level WHERE EXISTS', () => {
        const { sql } = Book.query()
            .include([
                {
                    model: Author,
                    required: true,
                    include: [{ model: Tag, required: true, where: { label: 'x' } }],
                },
            ])
            .toSQL()

        const where = sql.slice(sql.lastIndexOf('where exists'))
        expect(where).toContain('exists')
        expect(where).toContain('"label"')
    })

    it('the grandchild condition is not left inside the branch, where it could only null the child', () => {
        const { sql } = Book.query()
            .include([
                {
                    model: Author,
                    required: true,
                    include: [{ model: Tag, required: true, where: { label: 'x' } }],
                },
            ])
            .toSQL()

        // one occurrence in the loaded branch, one in the outer EXISTS — never only the branch
        expect(sql.slice(sql.lastIndexOf('where exists'))).toContain('"label"')
    })
})

describe('belongsToMany through includeQueryable keeps the junction hop', () => {
    it('the branch reads the junction and nests the target under it', () => {
        const { sql } = Author.query()
            .select(['id'])
            .includeQueryable(Tag.query().select(['id', 'label']))
            .toSQL()

        expect(sql).toContain('"author_tags"')
        expect(sql).toContain('"tags"')
        expect(sql).toContain('"label"')
    })

    it('a filter on the target binds against the target table', () => {
        const { sql } = Author.query()
            .includeQueryable(Tag.query().where({ label: 'x' }))
            .toSQL()
        expect(sql).not.toMatch(/"authors_tags"\."label"/)
    })

    it('{ required: true } builds the two-hop EXISTS the single-hop form could not', () => {
        const { sql } = Author.query()
            .includeQueryable(Tag.query().where({ label: 'x' }), { required: true })
            .toSQL()
        expect(sql).toContain('where exists')
        expect(sql).toContain('"author_tags"')
        expect(sql).toContain('"tags"')
    })

    it('include({ required: true }) on a m2m does the same', () => {
        const { sql } = Author.query()
            .include([{ model: Tag, required: true, where: { label: 'x' } }])
            .toSQL()
        expect(sql).toContain('where exists')
        expect(sql).toContain('"author_tags"')
    })
})

describe('asSubQuery() survives the outer query alias rewrite', () => {
    it('renders as a self-contained select over the named column', () => {
        const sub = Tag.query().where({ label: 'x' }).asSubQuery('id')
        const { sql } = Book.query().where(Op.in(sub).build(Book.column('authorId'))).toSQL()

        expect(sql).toContain('from "tags"')
        // the inner columns keep their own table; a `sql` template would have them reprinted as
        // "books"."label" by the relational query builder's alias walk
        expect(sql).not.toMatch(/"books"\."label"/)
    })

    it('names the model when the column does not exist', () => {
        expect(() => Tag.query().asSubQuery('nope')).toThrow(/Unknown column "nope" on tags/)
    })
})

describe('values are bound so the comparison stays answerable', () => {
    it('a fractional number against an integer column binds as numeric instead of failing to parse', () => {
        const { sql } = Book.query().where({ id: 1.5 }).toSQL()
        expect(sql).toContain('::numeric')
    })

    it('a whole number is untouched', () => {
        const { sql } = Book.query().where({ id: 2 }).toSQL()
        expect(sql).not.toContain('::numeric')
    })

    it('a fractional number against a non-integral column is untouched', () => {
        const { sql } = Book.query().where({ title: 1.5 }).toSQL()
        expect(sql).not.toContain('::numeric')
    })
})

describe('an undefined value never reaches the statement', () => {
    // bound as a parameter it becomes NULL, which turns the condition into one nothing satisfies —
    // a filter that stops filtering rather than an error
    it('a plain where value is refused, naming the column', () => {
        expect(() => Book.query().where({ title: undefined }).toSQL())
            .toThrow(/WHERE parameter "title" has invalid "undefined" value/)
    })

    it('a comparison operator is refused', () => {
        expect(() => Book.query().where({ id: Op.gt(undefined) }).toSQL()).toThrow(/invalid "undefined" value/)
        expect(() => Book.query().where({ title: Op.like(undefined as unknown as string) }).toSQL())
            .toThrow(/invalid "undefined" value/)
    })

    it('a list element is refused', () => {
        expect(() => Book.query().where({ id: Op.in([1, undefined]) }).toSQL()).toThrow(/invalid "undefined" value/)
    })

    it('null still means IS NULL', () => {
        const { sql } = Book.query().where({ title: null }).toSQL()
        expect(sql).toContain('is null')
    })

    it('getByPK answers without a statement instead of binding the missing key', async () => {
        const findFirst = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jest.spyOn(Orm, 'conn').mockReturnValue({ query: new Proxy({}, { get: () => ({ findFirst }) }) } as any)

        await expect(Book.query().getByPK(undefined)).resolves.toBeNull()
        await expect(Book.query().getByPK(null)).resolves.toBeNull()
        expect(findFirst).not.toHaveBeenCalled()
    })
})

describe('a date column takes what a date arrives as', () => {
    const driverValue = (value: unknown): unknown => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const column = Author.column('createdAt') as any
        return column.mapToDriverValue(value)
    }

    it('accepts a Date', () => {
        expect(driverValue(new Date('2026-08-23T10:00:00Z'))).toBe('2026-08-23T10:00:00.000Z')
    })

    it('accepts an ISO string, as a query parameter arrives', () => {
        expect(driverValue('2026-08-23T10:00:00.000Z')).toBe('2026-08-23T10:00:00.000Z')
    })

    it('accepts epoch milliseconds, which is what Date.prototype.setHours returns', () => {
        expect(driverValue(new Date('2026-08-23T10:00:00Z').getTime())).toBe('2026-08-23T10:00:00.000Z')
    })

    it('passes an unparseable value through for Postgres to report', () => {
        expect(driverValue('not-a-date')).toBe('not-a-date')
    })
})

describe('a loaded relation is reachable through dataValues', () => {
    it('reading and writing a relation goes through the same bag as a column', () => {
        const author = new Author()
        const tag = new Tag()
        author.tags = [tag]

        expect(author.dataValues.tags).toEqual([tag])
        expect(author.getDataValue('tags')).toEqual([tag])
        expect(author.tags).toEqual([tag])
    })

    it('assigning a relation does not make the model dirty', () => {
        const author = new Author()
        author.tags = [new Tag()]
        expect(author.changed()).not.toContain('tags')
    })

    it('a relation that was never loaded stays absent', () => {
        expect(new Author().dataValues.books).toBeUndefined()
    })

    it('AuthorTag is still the junction the m2m walks through', () => {
        expect(AuthorTag.meta.tableName).toBe('author_tags')
    })
})
