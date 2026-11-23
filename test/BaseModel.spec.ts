import { Orm, SchemaBuilder, SnakeCaseNamingStrategy } from '../src'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Author, AuthorTag, Book, SoftEntity } from './fixtures/testModels'
import { createMockDb, TMockDb } from './fixtures/mockDb'

let mock: TMockDb
let connSpy: jest.SpyInstance

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

beforeEach(() => {
    jest.clearAllMocks()
    mock = createMockDb(['authors', 'books', 'reviews', 'soft_entities', 'tags', 'author_tags'])
    connSpy = jest.spyOn(Orm, 'conn').mockReturnValue(mock.db)
})

describe('accessors', () => {
    it('routes reads/writes through dataValues', () => {
        const a = new Author()
        a.name = 'Ada'
        expect(a.name).toBe('Ada')
        expect(a.dataValues.name).toBe('Ada')
    })

    it('setter is a no-op for an identical value (stays clean)', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'A'
        expect(a.changed()).toBe(false)
    })

    it('setter marks the field dirty for a different value', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        expect(a.changed('name')).toBe(true)
    })

    it('tracks null assignments', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = null as any
        expect(a.changed('name')).toBe(true)
        expect(a.name).toBeNull()
    })
})

describe('toJSON() — serializing an instance', () => {
    it('serializes the row, not the internal state', () => {
        const a = Author.hydrate({ id: 1, name: 'Ada' }) as Author
        a.name = 'Grace'
        expect(JSON.parse(JSON.stringify(a))).toEqual({ id: 1, name: 'Grace' })
    })

    it('turns loaded relations into plain objects', () => {
        const a = Author.hydrate({ id: 1, name: 'Ada', books: [{ id: 7, title: 'Notes', authorId: 1 }] }) as Author
        const plain = a.toJSON()
        expect(plain.books).toEqual([{ id: 7, title: 'Notes', authorId: 1 }])
        expect((plain.books as unknown[])[0]).not.toBeInstanceOf(Book)
    })

    it('keeps a loaded empty relation', () => {
        const a = Author.hydrate({ id: 1, name: 'Ada', books: [] }) as Author
        expect(a.toJSON()).toEqual({ id: 1, name: 'Ada', books: [] })
    })
})

describe('changed()', () => {
    it('returns false when nothing changed', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        expect(a.changed()).toBe(false)
    })

    it('returns the list of changed fields', () => {
        const a = Author.hydrate({ id: 1, name: 'A', age: 1 }) as Author
        a.name = 'B'
        a.age = 2
        expect((a.changed() as string[]).sort()).toEqual(['age', 'name'])
    })

    it('changed(field) returns a boolean', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        expect(a.changed('name')).toBe(true)
        expect(a.changed('age')).toBe(false)
    })

    it('changed(field, flag) sets and clears the flag manually', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.changed('name', true)
        expect(a.changed('name')).toBe(true)
        a.changed('name', false)
        expect(a.changed('name')).toBe(false)
    })

    it('returns a copy, not the internal set (mutation-safe)', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        const list = a.changed() as string[]
        list.push('injected')
        expect(a.changed()).toEqual(['name'])
    })
})

describe('build()', () => {
    it('marks every provided field as changed', () => {
        const a = Author.build({ name: 'New', age: 5 } as any)
        expect((a.changed() as string[]).sort()).toEqual(['age', 'name'])
    })

    it('has no primary key set', () => {
        const a = Author.build({ name: 'New' })
        expect(a.dataValues.id).toBeUndefined()
    })
})

describe('save() — UPDATE path', () => {
    it('performs NO query when nothing changed', async () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        await a.save()
        expect(connSpy).not.toHaveBeenCalled()
    })

    it('updates only the changed columns', async () => {
        const a = Author.hydrate({ id: 1, name: 'A', age: 1 }) as Author
        a.age = 2
        await a.save()
        expect(mock.calls.update).toHaveBeenCalledTimes(1)
        expect(mock.calls.set).toHaveBeenCalledWith({ age: 2 })
    })

    it('clears the dirty flag after a successful save', async () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        await a.save()
        expect(a.changed()).toBe(false)
    })

    it('a second save right after does nothing', async () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        await a.save()
        jest.clearAllMocks()
        await a.save()
        expect(connSpy).not.toHaveBeenCalled()
    })
})

describe('save() — INSERT path', () => {
    it('inserts when there is no primary key and applies the returning row', async () => {
        mock.returningRows = [{ id: 999 }]
        const a = Author.build({ name: 'New' })
        await a.save()
        expect(mock.calls.insert).toHaveBeenCalledTimes(1)
        expect(a.id).toBe(999)
        expect(a.changed()).toBe(false)
    })

    it('excludes an unset auto-increment primary key from the insert', async () => {
        const a = Author.build({ name: 'New' })
        await a.save()
        const values = mock.calls.values.mock.calls[0][0]
        expect(values).not.toHaveProperty('id')
        expect(values).toMatchObject({ name: 'New' })
    })
})

describe('update(patch)', () => {
    it('does nothing when the patch equals current values', async () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        await a.update({ name: 'A' } as any)
        expect(connSpy).not.toHaveBeenCalled()
    })

    it('updates only the fields that actually changed', async () => {
        const a = Author.hydrate({ id: 1, name: 'A', age: 1 }) as Author
        await a.update({ name: 'A', age: 9 } as any)
        expect(mock.calls.set).toHaveBeenCalledWith({ age: 9 })
    })
})

describe('update(patch) — undefined values', () => {
    it('issues no query when every patched value is undefined', async () => {
        const a = Author.hydrate({ id: 1, name: 'A', age: 1 }) as Author

        await expect(a.update({ name: undefined, age: undefined } as any)).resolves.toBe(a)

        // drizzle's set() ignores undefined keys and throws "No values to set" on an empty object
        expect(mock.calls.update).not.toHaveBeenCalled()
        expect(a.changed()).toBe(false)
    })

    it('writes the defined values and drops the undefined ones', async () => {
        const a = Author.hydrate({ id: 1, name: 'A', age: 1 }) as Author

        await a.update({ name: 'B', age: undefined } as any)

        // toStrictEqual, not toHaveBeenCalledWith: the latter treats { age: undefined } as absent
        expect(mock.calls.set.mock.calls[0][0]).toStrictEqual({ name: 'B' })
    })

    it('still writes null — only undefined means "not provided"', async () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author

        await a.update({ name: null } as any)

        expect(mock.calls.set).toHaveBeenCalledWith({ name: null })
    })
})

describe('destroy()', () => {
    it('issues a DELETE for a non-paranoid model', async () => {
        const a = Author.hydrate({ id: 5, name: 'A' }) as Author
        await a.destroy()
        expect(mock.calls.delete).toHaveBeenCalledTimes(1)
        expect(mock.calls.insert).not.toHaveBeenCalled()
    })

    it('soft-deletes (UPDATE deleted_at) for a paranoid model', async () => {
        const s = SoftEntity.hydrate({ id: 3, title: 'x' }) as SoftEntity
        await s.destroy()
        expect(mock.calls.update).toHaveBeenCalledTimes(1)
        const setArg = mock.calls.set.mock.calls[0][0] as { deletedAt: Date }
        expect(setArg.deletedAt).toBeInstanceOf(Date)
        expect(mock.calls.delete).not.toHaveBeenCalled()
    })
})

describe('reload()', () => {
    it('re-fetches by pk and refreshes dataValues, staying clean', async () => {
        mock.findFirstRow = { id: 1, name: 'Reloaded' }
        const a = Author.hydrate({ id: 1, name: 'Stale' }) as Author
        a.name = 'LocalEdit'
        await a.reload()
        expect(a.name).toBe('Reloaded')
        expect(a.changed()).toBe(false)
    })

    it('copies non-column own properties (computed/relations) from the fresh row', async () => {
        mock.findFirstRow = { id: 1, name: 'R', booksCount: 4 }
        const a = Author.hydrate({ id: 1, name: 'Stale' }) as Author
        await a.reload()
        expect((a as any).booksCount).toBe(4)
    })
})

describe('dataValue helpers', () => {
    it('setDataValue writes and marks dirty; getDataValue reads', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.setDataValue('name', 'Raw')
        expect(a.getDataValue('name')).toBe('Raw')
        expect(a.name).toBe('Raw')
        expect(a.changed()).toEqual(['name'])
    })

    it('save() writes a value set through setDataValue', async () => {
        mock.returningRows = [{ id: 1, name: 'Raw' }]
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.setDataValue('name', 'Raw')
        await a.save()
        expect(mock.calls.set).toHaveBeenCalledWith({ name: 'Raw' })
    })

    it('a hydrated instance is clean, so setDataValue is what makes it dirty', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        expect(a.changed()).toBe(false)
    })

    it('setDataValue leaves a populated primary key alone, exactly as an assignment does', () => {
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.setDataValue('id', 99)
        expect(a.id).toBe(1)
        expect(a.changed()).toBe(false)
    })

    it('setDataValue seeds a primary key that has no value yet', () => {
        const a = new Author()
        a.setDataValue('id', 7)
        expect(a.id).toBe(7)
    })
})

describe('static create / bulkCreate / destroy', () => {
    it('create inserts and returns a hydrated instance', async () => {
        mock.returningRows = [{ id: 7, name: 'A' }]
        const a = await Author.create({ name: 'A' })
        expect(mock.calls.insert).toHaveBeenCalled()
        expect(a).toBeInstanceOf(Author)
        expect(a.id).toBe(7)
        expect(a.changed()).toBe(false)
    })

    it('bulkCreate returns [] without touching the db for an empty array', async () => {
        const res = await Author.bulkCreate([])
        expect(res).toEqual([])
        expect(connSpy).not.toHaveBeenCalled()
    })

    it('bulkCreate inserts many and hydrates each', async () => {
        mock.returningRows = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
        const res = await Author.bulkCreate([{ name: 'A' }, { name: 'B' }])
        expect(res).toHaveLength(2)
        expect(res[1]).toBeInstanceOf(Author)
        expect(res[1].id).toBe(2)
    })

    it('static destroy deletes by where', async () => {
        await Author.destroy({ where: { id: [1, 2, 3] } })
        expect(mock.calls.delete).toHaveBeenCalledTimes(1)
    })

    it('static update writes the values to every matching row', async () => {
        await Author.update({ age: 0 }, { where: { id: [1, 2, 3] } })
        expect(mock.calls.update).toHaveBeenCalledTimes(1)
        expect(mock.calls.set).toHaveBeenCalledWith({ age: 0 })
        expect(mock.calls.updateWhere.mock.calls[0][0]).toBeDefined()
    })

    it('static update forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        await Author.update({ age: 1 }, { where: { id: 1 }, transaction: tx })
        expect(connSpy.mock.calls[0][0]).toBe(tx)
    })

    it('bulkCreate forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        mock.returningRows = [{ id: 1, name: 'A' }]
        await Author.bulkCreate([{ name: 'A' }], { transaction: tx })
        expect(connSpy.mock.calls[0][0]).toBe(tx)
    })
})

describe('transaction passthrough', () => {
    it('forwards the transaction to conn() on create', async () => {
        const tx = { __tx: true } as any
        mock.returningRows = [{ id: 1, name: 'A' }]
        await Author.create({ name: 'A' }, { transaction: tx })
        expect(connSpy.mock.calls[0][0]).toBe(tx)
    })

    it('save() (UPDATE) forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        a.name = 'B'
        await a.save({ transaction: tx })
        expect(connSpy.mock.calls.some(c => c[0] === tx)).toBe(true)
    })

    it('save() (INSERT) forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        mock.returningRows = [{ id: 9, name: 'New' }]
        const a = Author.build({ name: 'New' })
        await a.save({ transaction: tx })
        expect(connSpy.mock.calls.some(c => c[0] === tx)).toBe(true)
    })

    it('update() forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        const a = Author.hydrate({ id: 1, name: 'A' }) as Author
        await a.update({ name: 'B' } as any, { transaction: tx })
        expect(connSpy.mock.calls.some(c => c[0] === tx)).toBe(true)
    })

    it('destroy() forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        const a = Author.hydrate({ id: 5, name: 'A' }) as Author
        await a.destroy({ transaction: tx })
        expect(connSpy.mock.calls.some(c => c[0] === tx)).toBe(true)
    })
})

describe('static metadata', () => {
    it('exposes primaryKeyAttribute and meta', () => {
        expect(Author.primaryKeyAttribute).toBe('id')
        expect(Author.meta.tableName).toBe('authors')
        expect(Book.primaryKeyAttribute).toBe('id')
    })
})

describe('timestamp roles & schema wiring', () => {
    it('records created/updated role keys in meta (flag over @NamedColumn)', () => {
        expect(Author.meta.createdAtKey).toBe('createdAt')
        expect(Author.meta.updatedAtKey).toBe('updatedAt')
    })

    it('records the deleted role key + paranoid flag for a soft model', () => {
        expect(SoftEntity.meta.deletedAtKey).toBe('deletedAt')
        expect(SoftEntity.meta.paranoid).toBe(true)
    })

    it('attaches a client-side default to @CreatedColumn', () => {
        const table = Author.meta.drizzleTable as any
        expect(typeof table.createdAt.defaultFn).toBe('function')
    })

    it('attaches default + onUpdate to @UpdatedColumn', () => {
        const table = Author.meta.drizzleTable as any
        expect(typeof table.updatedAt.defaultFn).toBe('function')
        expect(typeof table.updatedAt.onUpdateFn).toBe('function')
    })

    it('leaves a plain column without timestamp functions', () => {
        const table = Author.meta.drizzleTable as any
        expect(table.name.defaultFn).toBeUndefined()
        expect(table.name.onUpdateFn).toBeUndefined()
    })
})

describe('static bulkUpsert', () => {
    const renderSql = (chunk: unknown): string => new PgDialect().sqlToQuery(chunk as any).sql

    const upsertArg = (): { target: unknown[]; set: Record<string, unknown> } =>
        mock.calls.onConflictDoUpdate.mock.calls[0][0] as { target: unknown[]; set: Record<string, unknown> }

    it('does nothing (no query) for an empty array', async () => {
        await Author.bulkUpsert([], { conflictKeys: ['id'] })
        expect(connSpy).not.toHaveBeenCalled()
        expect(mock.calls.insert).not.toHaveBeenCalled()
    })

    it('inserts through the model drizzle table with the provided rows', async () => {
        const rows = [{ name: 'A' }, { name: 'B' }]
        await Author.bulkUpsert(rows, { conflictKeys: ['name'], updateKeys: ['name'] })
        expect(mock.calls.insert).toHaveBeenCalledTimes(1)
        expect(mock.calls.insert).toHaveBeenCalledWith(Author.meta.drizzleTable)
        expect(mock.calls.values).toHaveBeenCalledWith(rows)
        expect(mock.calls.onConflictDoUpdate).toHaveBeenCalledTimes(1)
    })

    it('uses the conflict keys as the ON CONFLICT target columns', async () => {
        await Author.bulkUpsert([{ name: 'A', age: 1 }], { conflictKeys: ['name'], updateKeys: ['age'] })
        const table = Author.meta.drizzleTable as any
        const { target } = upsertArg()
        expect(target).toHaveLength(1)
        expect(target[0]).toBe(table.name)
    })

    it('supports a composite conflict target', async () => {
        await AuthorTag.bulkUpsert([{ authorId: 1, tagId: 2 }], { conflictKeys: ['authorId', 'tagId'], updateKeys: ['tagId'] })
        const table = AuthorTag.meta.drizzleTable as any
        const { target } = upsertArg()
        expect(target).toEqual([table.authorId, table.tagId])
    })

    it('returns the written rows hydrated into instances', async () => {
        mock.returningRows = [{ id: 3, name: 'A' }]
        const res = await Author.bulkUpsert([{ name: 'A' }], { conflictKeys: ['name'], updateKeys: ['name'] })
        expect(res).toHaveLength(1)
        expect(res[0]).toBeInstanceOf(Author)
        expect(res[0].id).toBe(3)
    })

    describe('SET clause', () => {
        it('is replaced by do nothing when neither update nor increment keys are given', async () => {
            await Author.bulkUpsert([{ name: 'A' }], { conflictKeys: ['name'] })
            const table = Author.meta.drizzleTable as any
            expect(mock.calls.onConflictDoUpdate).not.toHaveBeenCalled()
            expect(mock.calls.onConflictDoNothing).toHaveBeenCalledWith({ target: [table.name] })
        })

        it('updateKeys overwrite the column with the incoming excluded value', async () => {
            await Author.bulkUpsert([{ name: 'A', age: 2 }], { conflictKeys: ['name'], updateKeys: ['age'] })
            const { set } = upsertArg()
            expect(Object.keys(set)).toEqual(['age'])
            expect(renderSql(set.age)).toBe('excluded.age')
        })

        it('maps a camelCase property to its snake_case column name in the excluded ref', async () => {
            await Author.bulkUpsert([{ firstName: 'Ada' }], { conflictKeys: ['id'], updateKeys: ['firstName'] })
            expect(renderSql(upsertArg().set.firstName)).toBe('excluded.first_name')
        })

        it('incrementKeys accumulate: column = column + excluded.column', async () => {
            await Author.bulkUpsert([{ age: 5 }], { conflictKeys: ['id'], incrementKeys: ['age'] })
            expect(renderSql(upsertArg().set.age)).toBe('"authors"."age" + excluded.age')
        })

        it('combines update and increment keys in a single SET', async () => {
            await Author.bulkUpsert([{ name: 'A', age: 1 }], {
                conflictKeys: ['id'],
                updateKeys: ['name'],
                incrementKeys: ['age'],
            })
            const { set } = upsertArg()
            expect(Object.keys(set).sort()).toEqual(['age', 'name'])
            expect(renderSql(set.name)).toBe('excluded.name')
            expect(renderSql(set.age)).toBe('"authors"."age" + excluded.age')
        })

        it('silently ignores keys that are not real columns', async () => {
            await Author.bulkUpsert([{ name: 'A' }], {
                conflictKeys: ['id'],
                updateKeys: ['name', 'notAColumn' as any],
                incrementKeys: ['alsoMissing' as any],
            })
            expect(Object.keys(upsertArg().set)).toEqual(['name'])
        })
    })

    it('forwards the transaction to conn()', async () => {
        const tx = { __tx: true } as any
        await Author.bulkUpsert([{ name: 'A' }], { conflictKeys: ['name'], transaction: tx })
        expect(connSpy.mock.calls[0][0]).toBe(tx)
    })

    it('uses the default (non-transaction) connection when no transaction is passed', async () => {
        await Author.bulkUpsert([{ name: 'A' }], { conflictKeys: ['name'] })
        expect(connSpy.mock.calls[0][0]).toBeUndefined()
    })
})
