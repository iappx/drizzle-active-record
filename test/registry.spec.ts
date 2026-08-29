import { CreatedColumn, DataType, DeletedColumn, ForeignKey, HasOne, NamedColumn, Table, UpdatedColumn, ModelRegistry, QueryableModel } from '../src'

describe('ModelRegistry — direct API', () => {
    it('require() throws for an unregistered class', () => {
        class Unregistered {}
        expect(() => ModelRegistry.require(Unregistered)).toThrow(/not registered/)
    })

    it('get() returns undefined for an unregistered class', () => {
        class Unregistered {}
        expect(ModelRegistry.get(Unregistered)).toBeUndefined()
    })

    it('defineRelation merges into an existing relation with the same propertyKey', () => {
        class Holder {}
        ModelRegistry.defineRelation(Holder, { propertyKey: 'rel', kind: 'hasMany', target: () => Holder })
        ModelRegistry.defineRelation(Holder, { propertyKey: 'rel', kind: 'belongsTo', target: () => Holder, foreignKey: 'x' })
        const meta = ModelRegistry.require(Holder)
        expect(meta.relations).toHaveLength(1)
        expect(meta.relations[0].kind).toBe('belongsTo')
        expect(meta.relations[0].foreignKey).toBe('x')
    })

    it('all() returns every registered model', () => {
        @Table('reg_a')
        class RegA extends QueryableModel<RegA, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number
        }
        expect(ModelRegistry.all().some(m => m.modelCtor === RegA)).toBe(true)
    })
})

describe('@Table', () => {
    it('object form keeps paranoid and ignores extra/legacy options', () => {
        @Table({ tableName: 'tbl_x', paranoid: true, timestamps: true, createdAt: 'created_at' } as any)
        class TblX extends QueryableModel<TblX, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number
        }
        const meta = ModelRegistry.require(TblX)
        expect(meta.tableName).toBe('tbl_x')
        expect(meta.paranoid).toBe(true)
        expect('timestamps' in meta).toBe(false)
    })
})

describe('@CreatedColumn / @UpdatedColumn / @DeletedColumn', () => {
    it('flags the column beneath it, without duplicating it, and records the role key in meta', () => {
        @Table({ tableName: 'ts_test', paranoid: true })
        class TsTest extends QueryableModel<TsTest, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @CreatedColumn()
            @NamedColumn(DataType.DATE, 'created_at')
            createdAt: Date

            @UpdatedColumn()
            @NamedColumn(DataType.DATE, 'updated_at')
            updatedAt: Date

            @DeletedColumn()
            @NamedColumn(DataType.DATE, 'deleted_at')
            deletedAt: Date
        }
        const meta = ModelRegistry.require(TsTest)
        expect(meta.createdAtKey).toBe('createdAt')
        expect(meta.updatedAtKey).toBe('updatedAt')
        expect(meta.deletedAtKey).toBe('deletedAt')
        expect(meta.columns.filter(c => c.propertyKey === 'createdAt')).toHaveLength(1)
        expect(meta.columns.find(c => c.propertyKey === 'createdAt')?.role).toBe('createdAt')
    })

    it('registers a fallback DATE column when the flag has no @NamedColumn beneath it', () => {
        @Table('ts_fallback')
        class TsFallback extends QueryableModel<TsFallback, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @CreatedColumn()
            createdAt: Date
        }
        const meta = ModelRegistry.require(TsFallback)
        const col = meta.columns.find(c => c.propertyKey === 'createdAt')
        expect(col?.columnName).toBeUndefined()
        expect(col?.dataType.kind).toBe('date')
        expect(meta.createdAtKey).toBe('createdAt')
    })
})

describe('@NamedColumn', () => {
    it('leaves the column name unresolved when it is omitted', () => {
        @Table('nc_test')
        class NcTest extends QueryableModel<NcTest, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @NamedColumn(DataType.STRING)
            longFieldName: string
        }
        const col = ModelRegistry.require(NcTest).columns.find(c => c.propertyKey === 'longFieldName')
        expect(col?.columnName).toBeUndefined()
    })
})

describe('@ForeignKey', () => {
    it('records the target on the matching column', () => {
        class FkTarget {}
        @Table('fk_a')
        class FkA extends QueryableModel<FkA, { targetId: number }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @ForeignKey(() => FkTarget)
            @NamedColumn(DataType.BIGINT, 'target_id')
            targetId: number
        }
        const col = ModelRegistry.require(FkA).columns.find(c => c.propertyKey === 'targetId')
        expect(col?.foreignKeyTargets?.map(target => target())).toEqual([FkTarget])
    })

    it('collects every target when one column is a foreign key to several models', () => {
        class FkTargetA {}
        class FkTargetB {}
        @Table('fk_c')
        class FkC extends QueryableModel<FkC, { targetId: number }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @ForeignKey(() => FkTargetA)
            @ForeignKey(() => FkTargetB)
            @NamedColumn(DataType.BIGINT, 'target_id')
            targetId: number
        }
        const col = ModelRegistry.require(FkC).columns.find(c => c.propertyKey === 'targetId')
        expect(col?.foreignKeyTargets?.map(target => target())).toEqual(
            expect.arrayContaining([FkTargetA, FkTargetB]),
        )
    })

    it('creates a fallback column when @ForeignKey has no @NamedColumn beneath it', () => {
        class FkTarget2 {}
        @Table('fk_b')
        class FkB extends QueryableModel<FkB, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            // @ForeignKey without an accompanying @NamedColumn -> fallback column
            @ForeignKey(() => FkTarget2)
            loneFk: number
        }
        const col = ModelRegistry.require(FkB).columns.find(c => c.propertyKey === 'loneFk')
        expect(col).toBeDefined()
        expect(col?.columnName).toBeUndefined()
        expect(col?.foreignKeyTargets?.map(target => target())).toEqual([FkTarget2])
    })
})

describe('@HasOne', () => {
    it('registers a belongsTo-kind relation', () => {
        class OneTarget {}
        @Table('ho_test')
        class HoTest extends QueryableModel<HoTest, { v: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number

            @HasOne(() => OneTarget)
            target: any
        }
        const rel = ModelRegistry.require(HoTest).relations.find(r => r.propertyKey === 'target')
        expect(rel?.kind).toBe('belongsTo')
    })
})

describe('@Index', () => {
    it('is a no-op and does not add a column', () => {
        @Table('idx_test')
        class IdxTest extends QueryableModel<IdxTest, { name: string }> {
            @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
            id: number
            @NamedColumn(DataType.STRING, 'name')
            name: string
        }
        const meta = ModelRegistry.require(IdxTest)
        expect(meta.columns).toHaveLength(2)
    })
})
