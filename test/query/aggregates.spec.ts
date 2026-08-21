import { Orm, SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL, sql } from 'drizzle-orm'
import { Author } from '../fixtures/testModels'
import { createMockDb, TMockDb } from '../fixtures/mockDb'

const dialect = new PgDialect()
const sqlOf = (s: SQL) => dialect.sqlToQuery(s)

let mock: TMockDb

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

beforeEach(() => {
    jest.clearAllMocks()
    mock = createMockDb(['authors', 'books', 'reviews', 'tags', 'author_tags', 'soft_entities'])
    jest.spyOn(Orm, 'conn').mockReturnValue(mock.db)
})

describe('scalar aggregates', () => {
    it('max() selects max(column) and returns the value', async () => {
        mock.selectRows = [{ value: 77 }]
        const result = await Author.query().max<number>('age')

        expect(result).toBe(77)
        expect(sqlOf(mock.captured.selection.value).sql.toLowerCase()).toContain('max(')
    })

    it('min() selects min(column) and returns the value', async () => {
        mock.selectRows = [{ value: 18 }]
        const result = await Author.query().min<number>('age')

        expect(result).toBe(18)
        expect(sqlOf(mock.captured.selection.value).sql.toLowerCase()).toContain('min(')
    })

    it('an aggregate applies the accumulated where clause', async () => {
        mock.selectRows = [{ value: 1 }]
        await Author.query().where({ name: 'x' }).max('age')

        expect(sqlOf(mock.captured.selectWhere).params).toEqual(['x'])
    })

    it('an empty result yields null rather than undefined', async () => {
        mock.selectRows = []
        expect(await Author.query().max('age')).toBeNull()
    })

    it('an unknown column is rejected', async () => {
        await expect(Author.query().max('nope')).rejects.toThrow(/Unknown column "nope"/)
    })

    it('resolves a column by its database name too', async () => {
        mock.selectRows = [{ value: 3 }]
        await Author.query().max('first_name')

        expect(sqlOf(mock.captured.selection.value).sql).toContain('first_name')
    })
})

describe('grouped selects', () => {
    it('groupBy() leaves the relational query builder for a flat select', async () => {
        await Author.query().groupBy('name').getAll()

        expect(mock.calls.findMany).not.toHaveBeenCalled()
        expect(mock.calls.select).toHaveBeenCalled()
        expect(mock.captured.groupBy).toHaveLength(1)
    })

    it('having() is applied on top of the grouping', async () => {
        await Author.query()
            .select(['name'])
            .select({ extras: { total: sql`count(*)`.as('total') } })
            .groupBy('name')
            .having(sql`count(*) > 1`)
            .getAll()

        expect(sqlOf(mock.captured.having).sql).toContain('count(*) > 1')
        expect(Object.keys(mock.captured.selection)).toEqual(['name', 'total'])
    })

    it('order, limit and offset survive the switch to a flat select', async () => {
        await Author.query().groupBy('name').orderBy('name', 'DESC').limit(5).offset(10).getAll()

        expect(mock.captured.selectOrderBy).toHaveLength(1)
        expect(mock.captured.limit).toBe(5)
        expect(mock.captured.offset).toBe(10)
    })

    it('computed columns are readable through getDataValue()', async () => {
        mock.selectRows = [{ name: 'x', total: 3 }]
        const [row] = await Author.query()
            .select(['name'])
            .select({ extras: { total: sql`count(*)`.as('total') } })
            .groupBy('name')
            .getAll()

        expect(row.getDataValue('total')).toBe(3)
        expect((row as unknown as { total: number }).total).toBe(3)
    })

    it('getOne() on a grouped query returns the first row of the flat select', async () => {
        mock.selectRows = [{ name: 'first' }, { name: 'second' }]
        const row = await Author.query().groupBy('name').getOne()

        expect(mock.calls.findFirst).not.toHaveBeenCalled()
        expect(row?.name).toBe('first')
        expect(mock.captured.limit).toBe(1)
    })

    it('an ungrouped query still goes through the relational query builder', async () => {
        await Author.query().getAll()

        expect(mock.calls.findMany).toHaveBeenCalled()
        expect(mock.calls.select).not.toHaveBeenCalled()
    })
})
