import { SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'
import { Author, AuthorTag, Book, Profile, Review, SoftEntity } from '../fixtures/testModels'

const drizzleTable = (model: any) => model.meta.drizzleTable as any

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

describe('table registration', () => {
    it('registers every decorated model with its table name', () => {
        expect(Author.meta.tableName).toBe('authors')
        expect(Book.meta.tableName).toBe('books')
        expect(Review.meta.tableName).toBe('reviews')
    })

    it('carries the paranoid flag from @Table object form', () => {
        expect(SoftEntity.meta.paranoid).toBe(true)
        expect(Author.meta.paranoid).toBe(false)
    })

    it('detects the primary key column', () => {
        expect(Author.meta.primaryKey).toBe('id')
        expect(Author.primaryKeyAttribute).toBe('id')
    })
})

describe('column metadata', () => {
    it('defaults the column name to snake_case when omitted', () => {
        const name = Author.meta.columns.find(c => c.propertyKey === 'name')
        const firstName = Author.meta.columns.find(c => c.propertyKey === 'firstName')
        expect(name?.columnName).toBe('name')
        expect(firstName?.columnName).toBe('first_name')
    })

    it('keeps an explicit column name', () => {
        const age = Author.meta.columns.find(c => c.propertyKey === 'age')
        expect(age?.columnName).toBe('age')
    })

    it('records primaryKey and autoIncrement options', () => {
        const id = Author.meta.columns.find(c => c.propertyKey === 'id')
        expect(id?.options.primaryKey).toBe(true)
        expect(id?.options.autoIncrement).toBe(true)
    })

    it('preserves the declaration order of columns', () => {
        const keys = Author.meta.columns.map(c => c.propertyKey)
        expect(keys.slice(0, 4)).toEqual(['id', 'name', 'firstName', 'age'])
    })
})

describe('data type mapping (drizzle column SQL types)', () => {
    it('maps each DataType to the right pg column type', () => {
        const authors = drizzleTable(Author)
        const books = drizzleTable(Book)
        expect(authors.id.getSQLType()).toBe('bigint')
        expect(authors.age.getSQLType()).toBe('integer')
        expect(authors.active.getSQLType()).toBe('boolean')
        expect(authors.bio.getSQLType()).toBe('text')
        expect(authors.meta.getSQLType()).toBe('jsonb')
        expect(authors.createdAt.getSQLType()).toContain('timestamp')
        expect(authors.name.getSQLType()).toContain('varchar')
        expect(books.rating.getSQLType()).toBe('double precision')
        expect(books.status.getSQLType()).toBe('text') // enum stored as text at runtime
    })

    it('uses the snake_case db column name on the drizzle column', () => {
        expect(drizzleTable(Author).createdAt.name).toBe('created_at')
        expect(drizzleTable(Author).firstName.name).toBe('first_name')
    })
})

describe('relation metadata', () => {
    it('registers belongsTo / hasMany / belongsToMany kinds', () => {
        const authorRels = Object.fromEntries(Author.meta.relations.map(r => [r.propertyKey, r.kind]))
        expect(authorRels.books).toBe('hasMany')
        expect(authorRels.tags).toBe('belongsToMany')

        const bookRels = Object.fromEntries(Book.meta.relations.map(r => [r.propertyKey, r.kind]))
        expect(bookRels.author).toBe('belongsTo')
        expect(bookRels.reviews).toBe('hasMany')
    })

    it('links @ForeignKey target onto the FK column', () => {
        const authorId = Book.meta.columns.find(c => c.propertyKey === 'authorId')
        expect(authorId?.foreignKeyTarget?.()).toBe(Author)
    })
})

describe('schema output', () => {
    it('builds a drizzle table and relations set for each model', () => {
        const schema = SchemaBuilder.getSchema()
        expect(schema['authors']).toBeDefined()
        expect(schema['authorsRelations']).toBeDefined()
        expect(drizzleTable(Author)).toBeDefined()
    })

    it('is idempotent across multiple build() calls', () => {
        const a = SchemaBuilder.build()
        const b = SchemaBuilder.build()
        expect(a).toBe(b)
    })
})

describe('prototype accessors', () => {
    it('installs get/set accessors for every column', () => {
        const desc = Object.getOwnPropertyDescriptor(Author.prototype, 'age')
        expect(desc?.get).toBeInstanceOf(Function)
        expect(desc?.set).toBeInstanceOf(Function)
    })

    it('does not clobber a computed getter that is not a column', () => {
        const a = new Author()
        a.firstName = 'Ada'
        a.name = 'Lovelace'
        expect(a.displayName).toBe('Ada Lovelace')
    })

    it('does not install accessors for junction models without extra columns beyond fk', () => {
        // AuthorTag has id + two fk columns, all should be accessors
        const desc = Object.getOwnPropertyDescriptor(AuthorTag.prototype, 'tagId')
        expect(desc?.get).toBeInstanceOf(Function)
    })
})

describe('data type mapping — json and not-null', () => {
    it('maps DataType.JSON to the json column type', () => {
        expect(drizzleTable(Profile).settings.getSQLType()).toBe('json')
    })

    it('applies notNull to columns declared with allowNull: false', () => {
        expect(drizzleTable(Profile).slug.notNull).toBe(true)
    })

    it('leaves nullable columns without notNull', () => {
        expect(drizzleTable(Profile).bio.notNull).toBe(false)
    })
})

describe('buildRelationConfig (drizzle one/many wiring)', () => {
    const oneStub = () => jest.fn((_t: unknown, opts?: unknown) => ({ __one: true, opts }))
    const manyStub = () => jest.fn((t: unknown) => ({ __many: true, t }))

    it('belongsTo with an FK passes fields/references to one()', () => {
        const one = oneStub()
        const many = manyStub()
        const out = SchemaBuilder.buildRelationConfig(Book.meta, one, many) as any
        expect(out.author.__one).toBe(true)
        expect(one).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ fields: expect.any(Array), references: expect.any(Array) }),
        )
        expect(out.reviews.__many).toBe(true)
    })

    it('hasMany and belongsToMany both produce many()', () => {
        const out = SchemaBuilder.buildRelationConfig(Author.meta, oneStub(), manyStub()) as any
        expect(out.books.__many).toBe(true)
        expect(out.tags.__many).toBe(true)
    })

    it('belongsTo without an FK (HasOne) calls one() with only the target table', () => {
        const one = oneStub()
        const out = SchemaBuilder.buildRelationConfig(Profile.meta, one, manyStub()) as any
        expect(out.owner.__one).toBe(true)
        expect(one).toHaveBeenCalledWith(expect.anything())
        expect(one.mock.calls[0]).toHaveLength(1) // no fields/references config
    })

    it('skips a relation whose target model is not built', () => {
        class Unbuilt {}
        const meta: any = {
            drizzleTable: {},
            columns: [],
            relations: [{ propertyKey: 'x', kind: 'hasMany', target: () => Unbuilt }],
        }
        const out = SchemaBuilder.buildRelationConfig(meta, oneStub(), manyStub())
        expect(out).toEqual({})
    })
})
