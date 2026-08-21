import { eq, sql, SQL } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { Hydrator } from './Hydrator'
import { Orm } from '../connection/Orm'
import { Tx } from '../connection/types'
import { DBModelQuery } from '../query/DBModelQuery'
import { RecursiveDBModelQuery } from '../query/RecursiveDBModelQuery'
import { TRawIncludeInput } from '../query/types'
import { TTableMeta } from '../types/metadata'

export type TWriteOpts = { transaction?: Tx }

export type TReloadOpts = {
    include?: TRawIncludeInput[]
    transaction?: Tx
}

export type TBulkUpsertOpts = {
    conflictKeys: string[]
    updateKeys?: string[]
    incrementKeys?: string[]
    transaction?: Tx
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class BaseModel<M extends BaseModel = any, CA extends object = any> {
    public dataValues: Record<string, unknown> = {}
    public readonly _changed: Set<string> = new Set<string>()

    static get meta(): TTableMeta {
        return ModelRegistry.require(this)
    }

    static get primaryKeyAttribute(): string {
        return ModelRegistry.require(this).primaryKey
    }

    static query<M extends BaseModel>(this: new () => M): DBModelQuery<M> {
        return new DBModelQuery<M>(this)
    }

    static recursiveQuery<M extends BaseModel>(this: new () => M): RecursiveDBModelQuery<M> {
        return new RecursiveDBModelQuery<M>(this)
    }

    static hydrate<M extends BaseModel>(this: new () => M, row: Record<string, unknown>): M | null {
        return Hydrator.hydrate(this, row)
    }

    static build<M extends BaseModel>(this: new () => M, attrs: object): M {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = new this() as any
        Object.assign(inst, attrs)
        return inst as M
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async create<M extends BaseModel, C extends object = any>(this: new () => M, attrs: C, opts?: TWriteOpts): Promise<M> {
        const meta = ModelRegistry.require(this)
        const [row] = await Orm.conn(opts?.transaction).insert(meta.drizzleTable).values(attrs).returning()
        return Hydrator.hydrate(this, row) as M
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async bulkCreate<M extends BaseModel, C extends object = any>(this: new () => M, attrs: C[], opts?: TWriteOpts): Promise<M[]> {
        if (attrs.length === 0) {
            return []
        }
        const meta = ModelRegistry.require(this)
        const rows = await Orm.conn(opts?.transaction).insert(meta.drizzleTable).values(attrs).returning()
        return Hydrator.hydrateMany(this, rows)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async bulkUpsert<M extends BaseModel, C extends object = any>(
        this: new () => M,
        rows: C[],
        opts: TBulkUpsertOpts,
    ): Promise<M[]> {
        if (rows.length === 0) {
            return []
        }
        const meta = ModelRegistry.require(this)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = meta.drizzleTable as any
        const columnByKey = new Map(meta.columns.map(c => [c.propertyKey, c]))

        const target = opts.conflictKeys.map(key => table[key])
        const set: Record<string, SQL> = {}
        for (const key of opts.updateKeys ?? []) {
            const column = columnByKey.get(key)
            if (column) {
                set[key] = sql`excluded.${sql.raw(column.columnName)}`
            }
        }
        for (const key of opts.incrementKeys ?? []) {
            const column = columnByKey.get(key)
            if (column) {
                set[key] = sql`${table[key]} + excluded.${sql.raw(column.columnName)}`
            }
        }

        const written = await Orm.conn(opts.transaction).insert(table).values(rows).onConflictDoUpdate({ target, set }).returning()
        return Hydrator.hydrateMany(this, written)
    }

    static async destroy<M extends BaseModel>(this: new () => M, opts: { where: Record<string, unknown>; transaction?: Tx }): Promise<void> {
        const query = new DBModelQuery<M>(this)
        await query.where(opts.where).transaction(opts.transaction).delete()
    }

    public setDataValue(key: string, value: unknown): void {
        this.dataValues[key] = value
    }

    public getDataValue(key: string): unknown {
        return this.dataValues[key]
    }

    public changed(): string[] | false
    public changed(field: string): boolean
    public changed(field: string, flag: boolean): void
    public changed(field?: string, flag?: boolean): string[] | boolean | false | void {
        if (field === undefined) {
            return this._changed.size ? [...this._changed] : false
        }
        if (flag === undefined) {
            return this._changed.has(field)
        }
        if (flag) {
            this._changed.add(field)
        } else {
            this._changed.delete(field)
        }
    }

    async save(opts?: TWriteOpts): Promise<this> {
        const ctor = this.constructor as new () => this
        const meta = ModelRegistry.require(ctor)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = meta.drizzleTable as any
        const pk = meta.primaryKey
        const pkValue = this.dataValues[pk]

        if (pkValue != null) {
            const changedColumns = meta.columns.filter(c => this._changed.has(c.propertyKey))
            if (changedColumns.length === 0) {
                return this
            }
            const values: Record<string, unknown> = {}
            for (const c of changedColumns) {
                values[c.propertyKey] = this.dataValues[c.propertyKey]
            }
            const [row] = await Orm.conn(opts?.transaction).update(table).set(values).where(eq(table[pk], pkValue)).returning()
            this.applyRow(meta, row)
        } else {
            const values = this.insertValues(meta)
            const [row] = await Orm.conn(opts?.transaction).insert(table).values(values).returning()
            this.applyRow(meta, row)
        }
        this._changed.clear()
        return this
    }

    async update(patch: Partial<CA>, opts?: TWriteOpts): Promise<this> {
        Object.assign(this, patch)
        return this.save(opts)
    }

    async destroy(opts?: TWriteOpts): Promise<void> {
        const ctor = this.constructor as new () => this
        const meta = ModelRegistry.require(ctor)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = meta.drizzleTable as any
        const pk = meta.primaryKey
        if (meta.paranoid && meta.deletedAtKey) {
            await Orm.conn(opts?.transaction).update(table).set({ [meta.deletedAtKey]: new Date() }).where(eq(table[pk], this.dataValues[pk]))
        } else {
            await Orm.conn(opts?.transaction).delete(table).where(eq(table[pk], this.dataValues[pk]))
        }
    }

    async reload(opts?: TReloadOpts): Promise<this> {
        const ctor = this.constructor as new () => this
        const meta = ModelRegistry.require(ctor)
        const query = new DBModelQuery<this>(ctor)
        if (opts?.transaction) {
            query.transaction(opts.transaction)
        }
        if (opts?.include) {
            query.include(opts.include)
        }
        const fresh = await query.getByPK(this.dataValues[meta.primaryKey])
        if (fresh) {
            this.dataValues = { ...fresh.dataValues }
            this._changed.clear()
            for (const key of Object.keys(fresh)) {
                if (key !== 'dataValues' && key !== '_changed') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this as any)[key] = (fresh as any)[key]
                }
            }
        }
        return this
    }

    private applyRow(meta: TTableMeta, row: Record<string, unknown>): void {
        for (const c of meta.columns) {
            if (row && c.propertyKey in row) {
                this.dataValues[c.propertyKey] = row[c.propertyKey]
            }
        }
    }

    private insertValues(meta: TTableMeta): Record<string, unknown> {
        const values: Record<string, unknown> = {}
        for (const c of meta.columns) {
            if (c.options.autoIncrement && this.dataValues[c.propertyKey] == null) {
                continue
            }
            if (c.propertyKey in this.dataValues) {
                values[c.propertyKey] = this.dataValues[c.propertyKey]
            }
        }
        return values
    }
}
