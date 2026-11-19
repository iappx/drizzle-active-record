import { Orm, SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'
import { QueryExecutor } from '../../src/query/QueryExecutor'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Author, Book } from '../fixtures/testModels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any
let statements: { sql: string; params: unknown[] }[]

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
})

beforeEach(() => {
    jest.restoreAllMocks()
    statements = []
    jest.spyOn(Orm, 'conn').mockReturnValue(db)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(QueryExecutor, 'run').mockImplementation(async (build: () => any) => {
        const built = build()
        // the flat select path nests one QueryExecutor.run inside another
        if (typeof built?.toSQL !== 'function') {
            return built
        }
        statements.push(built.toSQL())
        return []
    })
})

describe('DBModelQuery.forUpdate — locking the selected rows', () => {
    it('getAll() renders a flat select ending in for update', async () => {
        await Author.query().forUpdate().where({ name: 'Ann' }).orderBy('id').getAll()

        expect(statements).toHaveLength(1)
        expect(statements[0].sql).toMatch(/^select .* from "authors" where .* order by "authors"\."id" asc for update$/)
        expect(statements[0].params).toEqual(['Ann'])
    })

    it('tryFindByPk() locks the one row it looks up', async () => {
        await expect(Author.query().forUpdate().tryFindByPk(7)).rejects.toThrow()

        expect(statements[0].sql).toMatch(/where "authors"\."id" = \$1 limit \$2 for update$/)
        expect(statements[0].params).toEqual([7, 1])
    })

    it('a query without forUpdate takes no lock', async () => {
        await Author.query().where({ name: 'Ann' }).getAll()

        expect(statements[0].sql).not.toContain('for update')
    })

    it('loading a relation on a locked query is refused', async () => {
        await expect(Author.query().forUpdate().include({ model: Book }).getAll())
            .rejects.toThrow(/Relations cannot be loaded on a query of authors that locks its rows/)
        expect(statements).toHaveLength(0)
    })
})

describe('BaseModel.bulkUpsert — the conflict clause', () => {
    it('without update or increment keys a conflict does nothing', async () => {
        await Author.bulkUpsert([{ name: 'Ann' }], { conflictKeys: ['name'] })

        expect(statements[0].sql).toContain('on conflict ("name") do nothing')
        expect(statements[0].sql).not.toContain('do update')
    })

    it('with update keys a conflict updates the row', async () => {
        await Author.bulkUpsert([{ name: 'Ann', age: 3 }], { conflictKeys: ['name'], updateKeys: ['age'] })

        expect(statements[0].sql).toContain('on conflict ("name") do update set "age" = excluded.age')
    })
})
