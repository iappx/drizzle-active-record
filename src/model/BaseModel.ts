import { eq, sql, SQL } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { Hydrator } from './Hydrator'
import { Orm } from '../connection/Orm'
import { Tx } from '../connection/types'
import { DBModelQuery } from '../query/DBModelQuery'
import { QueryExecutor } from '../query/QueryExecutor'
import { RecursiveDBModelQuery } from '../query/RecursiveDBModelQuery'
import { TableRef } from '../query/TableRef'
import { TRawIncludeInput } from '../query/types'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { TTableMeta } from '../types/metadata'

/**
 * A property key of the model, or any other string — a database column name, or a name computed at
 * runtime. Editor completion still offers the declared keys.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type TColumnKey<M> = Extract<keyof M, string> | (string & {})

/**
 * Options accepted by every write.
 *
 * @example
 * ```ts
 * await Orm.db.transaction(async transaction => {
 *     await Author.create({ name: 'Ada' }, { transaction })
 * })
 * ```
 */
export type TWriteOpts = { transaction?: Tx }

/** Options accepted by `reload()`. */
export type TReloadOpts = {
    /** Relations to load along with the fresh row. */
    include?: TRawIncludeInput[]
    transaction?: Tx
}

/**
 * The `ON CONFLICT` target of a `bulkUpsert()` and what the conflict does to the existing row.
 *
 * Keys are property keys of the model; a key that names no column is ignored.
 *
 * @example
 * ```ts
 * await Author.bulkUpsert(rows, {
 *     conflictKeys: ['name'],
 *     updateKeys: ['bio'],
 *     incrementKeys: ['age'],
 * })
 * ```
 */
export type TBulkUpsertOpts = {
    /** Columns forming the `ON CONFLICT` target. */
    conflictKeys: string[]
    /** Columns overwritten with the incoming value: `column = excluded.column`. */
    updateKeys?: string[]
    /** Columns accumulated instead of overwritten: `column = column + excluded.column`. */
    incrementKeys?: string[]
    transaction?: Tx
}

/**
 * Base of every model: column storage, dirty tracking, and the Active Record read and write API.
 *
 * Column values live in `dataValues`; `SchemaBuilder.build()` installs the decorated properties as
 * accessors over it, so an assignment that changes a value marks the key dirty and `save()` writes
 * only those keys. Reads are opened with the static `query()` and `recursiveQuery()`.
 *
 * `M` is the model type, `CA` the attribute set `create()` and the instance `update()` accept.
 *
 * @example
 * ```ts
 * const author = await Author.create({ name: 'Ada' })
 * author.name = 'Ada Lovelace'
 * await author.save()
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class BaseModel<M extends BaseModel = any, CA extends object = any> {
    /** Column values keyed by property name; every accessor reads and writes through it. */
    public dataValues: Record<string, unknown> = {}

    /** Keys marked dirty since the last hydrate or save. Read it through `changed()`. */
    public readonly _changed: Set<string> = new Set<string>()

    /**
     * Registered metadata of the model: table name, columns, relations, timestamp roles and the
     * built Drizzle table.
     *
     * @throws {Error} When the class carries no `@Table` decorator
     *
     * @example
     * ```ts
     * Author.meta.tableName // 'authors'
     * ```
     */
    static get meta(): TTableMeta {
        return ModelRegistry.require(this)
    }

    /**
     * Property key of the primary key column.
     *
     * @throws {Error} When the class carries no `@Table` decorator
     */
    static get primaryKeyAttribute(): string {
        return ModelRegistry.require(this).primaryKey
    }

    /**
     * The underlying Drizzle column, reachable without opening a query first.
     *
     * Accepts the property key or the database column name.
     *
     * @throws {Error} When the model has no such column, naming the model and the columns it does have
     *
     * @example
     * ```ts
     * const fullName = sql`${Author.column('firstName')} || ' ' || ${Author.column('name')}`
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static column<M extends BaseModel>(this: new () => M, propertyKey: TColumnKey<M>): any {
        const meta = ModelRegistry.require(this)
        if (!meta.drizzleTable) {
            // same fallback the query builder uses for entry points that never ran the bootstrap
            SchemaBuilder.build()
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = meta.drizzleTable as any
        const key = String(propertyKey)
        const column = table?.[key] ?? table?.[meta.columns.find(c => c.columnName === key)?.propertyKey ?? '']
        if (!column) {
            const known = meta.columns.map(c => `'${c.propertyKey}'`).join(', ')
            throw new Error(
                `Unknown column "${key}" on ${(this as { name?: string }).name ?? meta.tableName}. `
                + `Known columns: ${known}.`,
            )
        }
        return column
    }

    /**
     * Opens a query builder over this model's table.
     *
     * Each call returns a fresh builder; conditions, includes and ordering accumulate on it until
     * an execution method (`getAll`, `getOne`, `count`, `update`, `delete`, ...) runs the statement.
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .where({ active: true })
     *     .includeModel(Book)
     *         .where({ rating: Op.gte(4) })
     *     .endInclude()
     *     .orderBy('name')
     *     .getAll()
     * ```
     */
    static query<M extends BaseModel>(this: new () => M): DBModelQuery<M> {
        return new DBModelQuery<M>(this)
    }

    /**
     * Opens a `WITH RECURSIVE` query builder for walking a self-referencing table.
     *
     * The CTE is aliased back to the model's own table name, so `where`, `orderBy`, `limit` and
     * `offset` set on the recursive query filter the result of the recursion rather than the source
     * table. `anchor`, `step` and `on` are all required.
     *
     * @example
     * ```ts
     * const branch = await Category.recursiveQuery()
     *     .anchor(Category.query().where({ id: rootId }))
     *     .step(Category.query())
     *     .on((cte, step) => eq(cte.id, step.parentId))
     *     .getAll()
     * ```
     */
    static recursiveQuery<M extends BaseModel>(this: new () => M): RecursiveDBModelQuery<M> {
        return new RecursiveDBModelQuery<M>(this)
    }

    /**
     * A `TableRef` to this model's own table — the real one, or its recursive twin with
     * `{ recursive: true }` — for correlated sub-queries built without a `DBModelQuery` in hand.
     * Pass `{ as }` to alias it up front, e.g. when it feeds a hand-written `sql` fragment.
     */
    static ref<M extends BaseModel>(this: new () => M, opts?: { as?: string; recursive?: boolean }): TableRef<M> {
        return TableRef.of<M>(this, opts)
    }

    /**
     * Builds an instance from a raw database row, relations included.
     *
     * The instance comes back clean, so an immediate `save()` writes nothing.
     *
     * @returns `null` when the row is `null` or `undefined`
     *
     * @example
     * ```ts
     * const author = Author.hydrate({ id: 1, name: 'Ada' })
     * ```
     */
    static hydrate<M extends BaseModel>(this: new () => M, row: Record<string, unknown>): M | null {
        return Hydrator.hydrate(this, row)
    }

    /**
     * Creates an unsaved instance holding the given attributes.
     *
     * Every assigned field is marked as changed and no statement is issued, so the first `save()`
     * inserts the row.
     *
     * @example
     * ```ts
     * const draft = Author.build({ name: 'Ada' })
     * await draft.save()
     * ```
     */
    static build<M extends BaseModel>(this: new () => M, attrs: object): M {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = new this() as any
        Object.assign(inst, attrs)
        return inst as M
    }

    /**
     * Inserts one row and returns it hydrated from the `RETURNING` clause, database defaults
     * included.
     *
     * @example
     * ```ts
     * const author = await Author.create({ name: 'Ada' })
     * author.id // filled in by the database
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async create<M extends BaseModel, C extends object = any>(this: new () => M, attrs: C, opts?: TWriteOpts): Promise<M> {
        const meta = ModelRegistry.require(this)
        const [row] = await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).insert(meta.drizzleTable).values(attrs).returning())
        return Hydrator.hydrate(this, row) as M
    }

    /**
     * Inserts many rows in a single statement and returns them hydrated.
     *
     * An empty array returns `[]` without touching the database.
     *
     * @example
     * ```ts
     * const authors = await Author.bulkCreate([{ name: 'Ada' }, { name: 'Grace' }])
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async bulkCreate<M extends BaseModel, C extends object = any>(this: new () => M, attrs: C[], opts?: TWriteOpts): Promise<M[]> {
        if (attrs.length === 0) {
            return []
        }
        const meta = ModelRegistry.require(this)
        const rows = await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).insert(meta.drizzleTable).values(attrs).returning())
        return Hydrator.hydrateMany(this, rows)
    }

    /**
     * Inserts many rows with an `ON CONFLICT ... DO UPDATE` clause and returns the written rows
     * hydrated.
     *
     * An empty array returns `[]` without touching the database. With neither `updateKeys` nor
     * `incrementKeys` the clause is `ON CONFLICT ... DO NOTHING`: a conflicting row is left as it is
     * and is not among the returned rows. A key naming no column of the model is skipped.
     *
     * @example
     * ```ts
     * const authors = await Author.bulkUpsert([{ name: 'Ada', age: 1 }], {
     *     conflictKeys: ['name'],
     *     incrementKeys: ['age'],
     * })
     * // on conflict (name) do update set "age" = "authors"."age" + excluded.age
     *
     * await Author.bulkUpsert([{ name: 'Ada' }], { conflictKeys: ['name'] })
     * // on conflict (name) do nothing
     * ```
     */
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

        const insert = Orm.conn(opts.transaction).insert(table).values(rows)
        const statement = Object.keys(set).length > 0
            ? insert.onConflictDoUpdate({ target, set })
            : insert.onConflictDoNothing({ target })
        const written = await QueryExecutor.run<Record<string, unknown>[]>(() => statement.returning())
        return Hydrator.hydrateMany(this, written)
    }

    /**
     * Deletes every row matching `where`, without loading any of them.
     *
     * A `paranoid` model is soft-deleted instead: the statement stamps the deleted column.
     *
     * @example
     * ```ts
     * await Author.destroy({ where: { id: [1, 2, 3] } })
     * ```
     */
    static async destroy<M extends BaseModel>(this: new () => M, opts: { where: Record<string, unknown>; transaction?: Tx }): Promise<void> {
        const query = new DBModelQuery<M>(this)
        await query.where(opts.where).transaction(opts.transaction).delete()
    }

    /**
     * Mass `UPDATE` of every row matching `where`, without loading any of them.
     *
     * Keys whose value is `undefined` are dropped; a patch left with nothing to write issues no
     * statement.
     *
     * @example
     * ```ts
     * await Author.update({ active: false }, { where: { id: [1, 2, 3] } })
     * ```
     */
    static async update<M extends BaseModel>(
        this: new () => M,
        values: Record<string, unknown>,
        opts: { where: Record<string, unknown>; transaction?: Tx },
    ): Promise<void> {
        const query = new DBModelQuery<M>(this)
        await query.where(opts.where).transaction(opts.transaction).update(values)
    }

    /**
     * Writes a value into `dataValues` and marks the key changed, so `save()` writes it.
     *
     * Behaves like assigning the property, and additionally reaches keys that have no accessor —
     * a computed column from `select({ extras })`. Assigning a primary key that already holds a
     * value is ignored, here as in an assignment.
     *
     * @example
     * ```ts
     * author.setDataValue('name', 'Ada Lovelace')
     * await author.save()   // update "authors" set "name" = $1 where "id" = $2
     * ```
     */
    public setDataValue(key: string, value: unknown): void {
        // the primary key no-op of the property accessor, repeated: `save()` reads the WHERE value
        // out of `dataValues` after the write, so a changed key would match no row
        if (key === ModelRegistry.get(this.constructor)?.primaryKey && this.dataValues[key] != null) {
            return
        }
        this.dataValues[key] = value
        this._changed.add(key)
    }

    /** Reads a raw value out of `dataValues`, columns and computed select extras alike. */
    public getDataValue(key: string): unknown {
        return this.dataValues[key]
    }

    /**
     * The instance as a plain object: columns, computed select extras and loaded relations, the
     * relations turned into plain objects as well.
     *
     * `JSON.stringify` calls it, so a serialized model carries its row and not its internal state.
     *
     * @example
     * ```ts
     * const author = await Author.query().include([Book]).tryFindByPk(1)
     * JSON.stringify(author) // {"id":1,"name":"Ada","books":[{"id":7,"title":"Notes"}]}
     * ```
     */
    public toJSON(): Record<string, unknown> {
        const plain: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(this.dataValues)) {
            plain[key] = BaseModel.toPlain(value)
        }
        return plain
    }

    /**
     * Reads or sets the dirty state of the instance.
     *
     * With no argument it returns a fresh array of the changed keys, or `false` when nothing
     * changed. With a key it answers whether that key is dirty. With a key and a flag it marks the
     * key dirty or clean by hand.
     *
     * @example
     * ```ts
     * author.name = 'Ada Lovelace'
     * author.changed()          // ['name']
     * author.changed('age')     // false
     * author.changed('age', true)
     * ```
     */
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

    /**
     * Writes the instance to its table and refreshes it from the `RETURNING` row.
     *
     * An instance holding a primary key value is `UPDATE`d with the changed columns only; one
     * without it is `INSERT`ed. A clean instance, or one whose changed values are all `undefined`,
     * issues no statement. The dirty flags are cleared either way.
     *
     * @returns The same instance, for chaining
     *
     * @example
     * ```ts
     * const author = await Author.query().tryFindByPk(1)
     * author.name = 'Ada Lovelace'
     * await author.save()   // update "authors" set "name" = $1 where "id" = $2
     * ```
     */
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
                // drizzle's set() ignores undefined, so keeping such a key here would leave an
                // empty SET clause — the driver answers that with "No values to set"
                if (this.dataValues[c.propertyKey] === undefined) {
                    continue
                }
                values[c.propertyKey] = this.dataValues[c.propertyKey]
            }
            if (Object.keys(values).length === 0) {
                this._changed.clear()
                return this
            }
            const [row] = await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).update(table).set(values).where(eq(table[pk], pkValue)).returning())
            this.applyRow(meta, row)
        } else {
            const values = this.insertValues(meta)
            const [row] = await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).insert(table).values(values).returning())
            this.applyRow(meta, row)
        }
        this._changed.clear()
        return this
    }

    /**
     * Applies a patch to the instance and saves it.
     *
     * `undefined` means "this patch does not name the field", not "set it to null": such a key is
     * left alone, on the instance as well as in the statement. `null` is written. A patch that
     * changes nothing issues no statement.
     *
     * @returns The same instance, for chaining
     *
     * @example
     * ```ts
     * await author.update({ name: 'Ada Lovelace', age: undefined })
     * // update "authors" set "name" = $1 where "id" = $2
     * ```
     */
    async update(patch: Partial<CA>, opts?: TWriteOpts): Promise<this> {
        for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
            if (value !== undefined) {
                (this as unknown as Record<string, unknown>)[key] = value
            }
        }
        return this.save(opts)
    }

    /**
     * Deletes the row this instance holds the primary key of.
     *
     * A `paranoid` model is soft-deleted instead: the deleted column is stamped with the current
     * time. The instance itself keeps its values either way.
     *
     * @example
     * ```ts
     * await author.destroy()
     * ```
     */
    async destroy(opts?: TWriteOpts): Promise<void> {
        const ctor = this.constructor as new () => this
        const meta = ModelRegistry.require(ctor)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = meta.drizzleTable as any
        const pk = meta.primaryKey
        if (meta.paranoid && meta.deletedAtKey) {
            await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).update(table).set({ [meta.deletedAtKey]: new Date() }).where(eq(table[pk], this.dataValues[pk])))
        } else {
            await QueryExecutor.run<Record<string, unknown>[]>(() => Orm.conn(opts?.transaction).delete(table).where(eq(table[pk], this.dataValues[pk])))
        }
    }

    /**
     * Re-reads the row by primary key and refreshes the instance in place.
     *
     * Local edits are dropped and the instance comes back clean. Non-column properties of the fresh
     * instance — relations and computed select extras — are copied over as well. A row that no
     * longer exists leaves the instance untouched.
     *
     * @returns The same instance, for chaining
     *
     * @example
     * ```ts
     * await author.reload({ include: [Book] })
     * ```
     */
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

    private static toPlain(value: unknown): unknown {
        if (value instanceof BaseModel) {
            return value.toJSON()
        }
        if (Array.isArray(value)) {
            return value.map(item => BaseModel.toPlain(item))
        }
        return value
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
