import { Orm, SchemaBuilder, SnakeCaseNamingStrategy } from '../../src'
import { Author } from '../fixtures/testModels'
import { createMockDb, TMockDb } from '../fixtures/mockDb'

const writeDb = { marker: 'write' } as never
const readDb = { marker: 'read' } as never

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

afterEach(async () => {
    await Orm.close()
})

describe('Orm.conn — choosing a connection', () => {
    it('reads go to the primary unless the replica is asked for', () => {
        Orm.init({ db: writeDb, readDb })

        expect(Orm.conn()).toBe(writeDb)
        expect(Orm.conn(undefined, false)).toBe(writeDb)
        expect(Orm.conn(undefined, true)).toBe(readDb)
    })

    it('falls back to the primary when no replica is configured', () => {
        Orm.init({ db: writeDb })

        expect(Orm.hasReplica).toBe(false)
        expect(Orm.readDb).toBe(writeDb)
        expect(Orm.conn(undefined, true)).toBe(writeDb)
    })

    it('reports a configured replica', () => {
        Orm.init({ db: writeDb, readDb })

        expect(Orm.hasReplica).toBe(true)
        expect(Orm.readDb).toBe(readDb)
    })

    it('a transaction always stays on the connection it was opened on', () => {
        Orm.init({ db: writeDb, readDb })
        const tx = { marker: 'tx' } as never

        expect(Orm.conn(tx)).toBe(tx)
        expect(Orm.conn(tx, true)).toBe(tx)
    })

    it('close() forgets both connections', async () => {
        Orm.init({ db: writeDb, readDb })
        await Orm.close()

        expect(Orm.isInitialized).toBe(false)
        expect(Orm.hasReplica).toBe(false)
    })
})

describe('DBModelQuery — replica routing', () => {
    let mock: TMockDb
    let connSpy: jest.SpyInstance

    beforeEach(() => {
        jest.clearAllMocks()
        mock = createMockDb(['authors', 'books', 'reviews', 'tags', 'author_tags', 'soft_entities'])
        connSpy = jest.spyOn(Orm, 'conn').mockReturnValue(mock.db)
    })

    afterEach(() => {
        connSpy.mockRestore()
    })

    const replicaFlags = () => connSpy.mock.calls.map(call => call[1])

    it('a plain query does not ask for the replica', async () => {
        await Author.query().getAll()

        expect(replicaFlags()).not.toContain(true)
    })

    it('useReplica() routes the read to the replica', async () => {
        await Author.query().useReplica().getAll()

        expect(replicaFlags()).toContain(true)
    })

    it('useMaster() takes it back', async () => {
        await Author.query().useReplica().useMaster().getAll()

        expect(replicaFlags()).not.toContain(true)
    })

    it('count() honours the choice as well', async () => {
        await Author.query().useReplica().count()

        expect(replicaFlags()).toContain(true)
    })

    it('aggregates honour the choice as well', async () => {
        mock.selectRows = [{ value: 1 }]
        await Author.query().useReplica().max('age')

        expect(replicaFlags()).toContain(true)
    })
})
