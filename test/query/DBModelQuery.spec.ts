import { Orm, ModelNotFoundError, Op, SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL, gt, sql } from 'drizzle-orm'
import { Author, Book, Review, SoftEntity, Tag } from '../fixtures/testModels'
import { createMockDb, TMockDb } from '../fixtures/mockDb'

const dialect = new PgDialect()
const sqlOf = (s: SQL) => dialect.sqlToQuery(s)

let mock: TMockDb
let connSpy: jest.SpyInstance

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

beforeEach(() => {
    jest.clearAllMocks()
    mock = createMockDb(['authors', 'books', 'reviews', 'tags', 'author_tags', 'soft_entities'])
    connSpy = jest.spyOn(Orm, 'conn').mockReturnValue(mock.db)
})

const cfg = () => mock.captured.cfg

describe('where — plain-object semantics', () => {
    it('scalar -> "="', async () => {
        await Author.query().where({ name: 'x' }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql).toContain('=')
        expect(q.params).toEqual(['x'])
    })

    it('array -> "in (...)" with every element as a param', async () => {
        await Author.query().where({ id: [1, 2, 3] }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toContain('in (')
        expect(q.params).toEqual([1, 2, 3])
    })

    it('null -> "is null"', async () => {
        await Author.query().where({ age: null }).getAll()
        expect(sqlOf(cfg().where).sql.toLowerCase()).toContain('is null')
    })

    it('multiple where() calls are AND-ed together', async () => {
        await Author.query().where({ name: 'x' }).where({ age: 2 }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toContain('and')
        expect(q.params).toEqual(['x', 2])
    })

    it('accepts a raw drizzle SQL condition as-is', async () => {
        const table = (Author as any).meta.drizzleTable
        await Author.query().where(gt(table.age, 18)).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql).toContain('>')
        expect(q.params).toEqual([18])
    })

    it('omits where from the config when there is no condition', async () => {
        await Author.query().getAll()
        expect(cfg().where).toBeUndefined()
    })
})

describe('where — Op condition wrappers', () => {
    it('Op.gte(v) compiles to ">="', async () => {
        await Author.query().where({ age: Op.gte(18) }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql).toContain('>=')
        expect(q.params).toEqual([18])
    })

    it('Op.in([...]) compiles to "in (...)"', async () => {
        await Author.query().where({ id: Op.in([1, 2]) }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toContain('in (')
        expect(q.params).toEqual([1, 2])
    })

    it('Op.or(...) on one field composes with OR', async () => {
        await Author.query().where({ name: Op.or(Op.eq('a'), Op.eq('b')) }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toMatch(/\bor\b/)
        expect(q.params).toEqual(['a', 'b'])
    })

    it('a plain object with string keys is NOT an Op (jsonb "=")', async () => {
        await Author.query().where({ meta: { foo: 'bar' } }).getAll()
        expect(sqlOf(cfg().where).sql).toContain('=')
    })
})

describe('orWhere — cross-field OR', () => {
    it('.where(a).orWhere(b) produces "a OR b"', async () => {
        await Author.query().where({ name: 'x' }).orWhere({ age: Op.gte(5) }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toMatch(/\bor\b/)
        expect(q.params).toEqual(['x', 5])
    })

    it('orWhere as the first condition just adds it (nothing to OR against)', async () => {
        await Author.query().orWhere({ name: 'x' }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).not.toMatch(/\bor\b/)
        expect(q.params).toEqual(['x'])
    })
})

describe('orderBy', () => {
    it('(field, dir) orders by property name', async () => {
        await Author.query().orderBy('name', 'DESC').getAll()
        expect(cfg().orderBy).toHaveLength(1)
        expect(sqlOf(cfg().orderBy[0]).sql.toLowerCase()).toContain('desc')
    })

    it('array item without DESC defaults to ASC', async () => {
        await Author.query().orderBy([['name', 'ASC']]).getAll()
        expect(sqlOf(cfg().orderBy[0]).sql.toLowerCase()).toContain('asc')
    })

    it('resolves a qualified "ModelName.snake_column" path', async () => {
        await Author.query().orderBy([['Author.created_at', 'DESC']]).getAll()
        const s = sqlOf(cfg().orderBy[0]).sql
        expect(s).toContain('created_at')
        expect(s.toLowerCase()).toContain('desc')
    })

    it('resolves a bare snake_case column name', async () => {
        await Author.query().orderBy([['created_at', 'ASC']]).getAll()
        expect(sqlOf(cfg().orderBy[0]).sql).toContain('created_at')
    })

    it('skips a wrong model prefix', async () => {
        await Author.query().orderBy([['OtherModel.created_at', 'DESC']]).getAll()
        expect(cfg().orderBy).toBeUndefined()
    })

    it('skips an unresolvable nested path (no broken ORDER BY)', async () => {
        await Author.query().orderBy([['books.reviews.text', 'DESC']]).getAll()
        expect(cfg().orderBy).toBeUndefined()
    })

    it('accumulates multiple orderBy entries', async () => {
        await Author.query().orderBy('name', 'ASC').orderBy('age', 'DESC').getAll()
        expect(cfg().orderBy).toHaveLength(2)
    })
})

describe('limit / offset / select', () => {
    it('passes limit and offset through', async () => {
        await Author.query().limit(5).offset(15).getAll()
        expect(cfg().limit).toBe(5)
        expect(cfg().offset).toBe(15)
    })

    it('select(array) -> columns map', async () => {
        await Author.query().select(['id', 'name']).getAll()
        expect(cfg().columns).toEqual({ id: true, name: true })
    })

    it('select({ extras }) -> extras map for computed columns', async () => {
        await Author.query().select({ extras: { total: sql<number>`count(*)`.as('total') } }).getAll()
        expect(cfg().extras).toHaveProperty('total')
    })
})

describe('includeModel -> with', () => {
    it('adds the relation by its property name', async () => {
        await Author.query().includeModel(Book).endInclude().getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })

    it('applies where / orderBy / limit inside the included branch', async () => {
        await Author.query()
            .includeModel(Book).where({ title: 'T' }).orderBy('rating', 'DESC').limit(3).endInclude()
            .getAll()
        const branch = cfg().with.books
        expect(sqlOf(branch.where).params).toEqual(['T'])
        expect(branch.limit).toBe(3)
        expect(sqlOf(branch.orderBy[0]).sql.toLowerCase()).toContain('desc')
    })

    it('supports nested includes via endInclude chaining', async () => {
        await Author.query()
            .includeModel(Book)
                .includeModel(Review).endInclude()
            .endInclude()
            .getAll()
        expect(Object.keys(cfg().with.books.with)).toContain('reviews')
    })
})

describe('include (raw style)', () => {
    it('{ model } -> with', async () => {
        await Author.query().include({ model: Book }).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })

    it('accepts a bare model class', async () => {
        await Author.query().include(Book as any).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })

    it('{ model, where } -> the branch carries the filter', async () => {
        await Author.query().include({ model: Book, where: { title: 'T' } }).getAll()
        expect(sqlOf(cfg().with.books.where).params).toEqual(['T'])
    })

    it('accepts an array of includes', async () => {
        await Author.query().include([{ model: Book }]).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })
})

describe('includeModel — belongsToMany (m2m via junction)', () => {
    it('expands the m2m into a junction -> target nested "with"', async () => {
        await Author.query().includeModel(Tag).endInclude().getAll()
        // связь идёт через junction (author_tags), а её ключ 'tags' содержит вложенную связь на цель
        expect(Object.keys(cfg().with)).toContain('tags')
        expect(Object.keys(cfg().with.tags.with)).toContain('tag')
    })

    it('routes the target filter into the nested junction hop', async () => {
        await Author.query().includeModel(Tag).where({ label: 'ts' }).endInclude().getAll()
        expect(sqlOf(cfg().with.tags.with.tag.where).params).toEqual(['ts'])
    })

    it('raw include of a m2m relation expands via the junction too', async () => {
        await Author.query().include({ model: Tag, where: { label: 'x' } }).getAll()
        expect(Object.keys(cfg().with.tags.with)).toContain('tag')
        expect(sqlOf(cfg().with.tags.with.tag.where).params).toEqual(['x'])
    })
})

describe('includeQueryable', () => {
    it('attaches another query builder as a relation branch', async () => {
        await Author.query().includeQueryable(Book.query().where({ title: 'X' })).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
        expect(sqlOf(cfg().with.books.where).params).toEqual(['X'])
    })

    it('with { required: true } also adds a WHERE EXISTS on the parent', async () => {
        await Author.query().includeQueryable(Book.query().where({ title: 'X' }), { required: true }).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
        expect(cfg().where).toBeDefined()
    })
})

describe('execution methods', () => {
    it('getAll returns hydrated instances', async () => {
        mock.findManyRows = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
        const res = await Author.query().getAll()
        expect(res).toHaveLength(2)
        expect(res[0]).toBeInstanceOf(Author)
        expect(res[0].name).toBe('A')
    })

    it('getOne returns a hydrated instance or null', async () => {
        mock.findFirstRow = { id: 1, name: 'A' }
        expect((await Author.query().getOne())?.name).toBe('A')
        mock.findFirstRow = null
        expect(await Author.query().getOne()).toBeNull()
    })

    it('getByPK adds a primary-key equality filter', async () => {
        await Author.query().getByPK(42)
        expect(sqlOf(cfg().where).params).toEqual([42])
    })

    it('tryGetOne throws ModelNotFoundError when nothing is found', async () => {
        mock.findFirstRow = null
        await expect(Author.query().tryGetOne()).rejects.toBeInstanceOf(ModelNotFoundError)
    })

    it('tryFindByPk throws ModelNotFoundError when nothing is found', async () => {
        mock.findFirstRow = null
        await expect(Author.query().tryFindByPk(1)).rejects.toBeInstanceOf(ModelNotFoundError)
    })

    it('count delegates to $count with the accumulated where', async () => {
        mock.countValue = 12
        const n = await Author.query().where({ age: 5 }).count()
        expect(n).toBe(12)
        expect(mock.calls.count).toHaveBeenCalledTimes(1)
    })

    it('count passes an undefined where when no filter was set', async () => {
        mock.countValue = 3
        const n = await Author.query().count()
        expect(n).toBe(3)
        expect(mock.calls.count.mock.calls[0][0].where).toBeUndefined()
    })
})

describe('delete', () => {
    it('non-paranoid model issues a DELETE', async () => {
        await Author.query().where({ id: 1 }).delete()
        expect(mock.calls.delete).toHaveBeenCalledTimes(1)
    })

    it('deletes with an undefined where when no filter was set', async () => {
        await Author.query().delete()
        expect(mock.calls.delete).toHaveBeenCalledTimes(1)
        expect(mock.calls.deleteWhere).toHaveBeenCalledWith(undefined)
    })
})

describe('transaction', () => {
    it('routes execution through conn(tx)', async () => {
        const tx = { __tx: true } as any
        await Author.query().transaction(tx).getAll()
        expect(connSpy.mock.calls.some(c => c[0] === tx)).toBe(true)
    })
})

describe('error surfacing (exec)', () => {
    it('appends the underlying pg cause to the thrown error message', async () => {
        mock.db.query.authors.findMany = async () => {
            const e: any = new Error('Failed query: select ...')
            e.cause = new Error('syntax error at or near "desc"')
            throw e
        }
        await expect(Author.query().getAll()).rejects.toThrow(/syntax error at or near "desc"/)
    })

    it('rethrows as-is when there is no cause', async () => {
        mock.db.query.authors.findMany = async () => {
            throw new Error('plain failure')
        }
        await expect(Author.query().getAll()).rejects.toThrow('plain failure')
    })
})

describe('column()', () => {
    it('returns the drizzle column for a property name', () => {
        const col = Author.query().column('name')
        expect(col.name).toBe('name')
    })
})

describe('select — object and extras forms', () => {
    it('select({ col: true }) merges into columns', async () => {
        await Author.query().select({ id: true } as any).getAll()
        expect(cfg().columns).toEqual({ id: true })
    })
})

describe('orderBy — raw SQL passthrough', () => {
    it('accepts a raw drizzle SQL order expression', async () => {
        const table = (Author as any).meta.drizzleTable
        await Author.query().orderBy(sql`${table.name} desc`).getAll()
        expect(cfg().orderBy).toHaveLength(1)
    })
})

describe('includeModel — as / errors', () => {
    it('resolves the relation key from the { as } option', async () => {
        await Author.query().includeModel(Book, { as: 'books' }).endInclude().getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })

    it('throws for a model with no matching relation', () => {
        expect(() => Author.query().includeModel(Review)).toThrow(/No relation/)
    })
})

describe('include — as / nested / errors', () => {
    it('resolves a relation by { as }', async () => {
        await Author.query().include({ as: 'books' }).getAll()
        expect(Object.keys(cfg().with)).toContain('books')
    })

    it('throws when the raw include has no matching relation', () => {
        expect(() => Author.query().include({ model: Review })).toThrow(/No relation/)
    })

    it('applies nested raw includes recursively', async () => {
        await Author.query().include({ model: Book, include: [{ model: Review }] }).getAll()
        expect(Object.keys(cfg().with.books.with)).toContain('reviews')
    })

    it('throws with the { as } name when no relation matches', () => {
        expect(() => Author.query().include({ as: 'nope' })).toThrow(/nope/)
    })

    it('required: true adds a WHERE EXISTS filter on the parent (INNER JOIN semantics)', async () => {
        await Author.query().include({ model: Book, where: { title: 'X' }, required: true }).getAll()
        // relation still included (LEFT JOIN for data) ...
        expect(Object.keys(cfg().with)).toContain('books')
        // ... plus an EXISTS condition pushed onto the parent WHERE
        expect(cfg().where).toBeDefined()
    })

    it('required: false does NOT add a parent filter', async () => {
        await Author.query().include({ model: Book, where: { title: 'X' }, required: false }).getAll()
        expect(cfg().where).toBeUndefined()
    })
})

describe('execution — success returns of try*', () => {
    it('tryGetOne returns the row when found', async () => {
        mock.findFirstRow = { id: 1, name: 'A' }
        const a = await Author.query().tryGetOne()
        expect(a.name).toBe('A')
    })

    it('tryFindByPk returns the row when found', async () => {
        mock.findFirstRow = { id: 5, name: 'B' }
        const a = await Author.query().tryFindByPk(5)
        expect(a.name).toBe('B')
    })
})

describe('delete — paranoid', () => {
    it('soft-deletes (UPDATE deleted_at) for a paranoid model', async () => {
        await SoftEntity.query().where({ id: 1 }).delete()
        expect(mock.calls.update).toHaveBeenCalledTimes(1)
        const setArg = mock.calls.set.mock.calls[0][0] as { deletedAt: Date }
        expect(setArg.deletedAt).toBeInstanceOf(Date)
        expect(mock.calls.delete).not.toHaveBeenCalled()
    })
})

describe('paranoid — soft-delete read filter', () => {
    it('getAll adds "deleted_at is null" for a paranoid model', async () => {
        await SoftEntity.query().getAll()
        expect(sqlOf(cfg().where).sql.toLowerCase()).toContain('is null')
    })

    it('AND-combines the soft-delete filter with the user condition', async () => {
        await SoftEntity.query().where({ title: 'x' }).getAll()
        const q = sqlOf(cfg().where)
        expect(q.sql.toLowerCase()).toContain('is null')
        expect(q.sql.toLowerCase()).toContain('and')
        expect(q.params).toEqual(['x'])
    })

    it('getOne / getByPK still hide soft-deleted rows', async () => {
        await SoftEntity.query().getByPK(1)
        expect(sqlOf(cfg().where).sql.toLowerCase()).toContain('is null')
    })

    it('count includes the soft-delete filter', async () => {
        mock.countValue = 0
        await SoftEntity.query().count()
        expect(mock.calls.count.mock.calls[0][0].where).toBeDefined()
    })

    it('a non-paranoid model gets no soft-delete filter', async () => {
        await Author.query().getAll()
        expect(cfg().where).toBeUndefined()
    })
})

describe('toSQL()', () => {
    it('compiles the query to { sql, params }', () => {
        mock.db.query.authors.findMany = () => ({ toSQL: () => ({ sql: 'select 1', params: [] as unknown[] }) }) as any
        const out = Author.query().toSQL()
        expect(out.sql).toBe('select 1')
    })
})

describe('DBIncludeQuery — branch builder', () => {
    it('where() accepts a raw SQL condition', async () => {
        const bookTable = (Book as any).meta.drizzleTable
        await Author.query().includeModel(Book).where(gt(bookTable.rating, 4)).endInclude().getAll()
        expect(sqlOf(cfg().with.books.where).params).toEqual([4])
    })

    it('select() restricts columns on the branch', async () => {
        await Author.query().includeModel(Book).select(['title']).endInclude().getAll()
        expect(cfg().with.books.columns).toEqual({ title: true })
    })

    it('orderBy() defaults to ASC on the branch', async () => {
        await Author.query().includeModel(Book).orderBy('rating').endInclude().getAll()
        expect(sqlOf(cfg().with.books.orderBy[0]).sql.toLowerCase()).toContain('asc')
    })

    it('nested includeModel resolves via the { as } option', async () => {
        await Author.query()
            .includeModel(Book)
                .includeModel(Review, { as: 'reviews' }).endInclude()
            .endInclude()
            .getAll()
        expect(Object.keys(cfg().with.books.with)).toContain('reviews')
    })

    it('nested includeModel throws for an unrelated model', () => {
        expect(() => Author.query().includeModel(Book).includeModel(Tag)).toThrow(/No relation/)
    })

    it('conditionalEndInclude(true) returns the parent, (false) returns the branch', () => {
        const parent = Author.query()
        const branch = parent.includeModel(Book)
        expect(branch.conditionalEndInclude(true)).toBe(parent)
        expect(branch.conditionalEndInclude(false)).toBe(branch)
    })
})

describe('lazy schema rebuild (entry points outside app.module)', () => {
    it('rebuilds the schema on demand when drizzleTable is missing', () => {
        // simulate a fresh entry point: schema not yet built for this model
        ;(Author as any).meta.drizzleTable = undefined
        ;(SchemaBuilder as any).built = false
        const col = Author.query().column('name')
        expect(col).toBeDefined()
        expect(col.name).toBe('name')
    })
})
