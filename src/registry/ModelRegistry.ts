import { TColumnMeta, TColumnRole, TRelationMeta, TTableMeta, TTableOptions } from '../types/metadata'

/**
 * Process-wide store of the metadata the decorators collect for each model class.
 *
 * The `@Table`, `@NamedColumn`, `@CreatedColumn` and relation decorators write here as the model
 * classes are loaded; `SchemaBuilder` and the query layer read from it. Application code normally
 * only reads, to inspect what a model declares.
 *
 * @example
 * ```ts
 * const meta = ModelRegistry.get(Author)
 * meta?.tableName // 'authors'
 * meta?.columns.map(c => c.propertyKey) // ['id', 'name', 'firstName', ...]
 * ```
 */
export class ModelRegistry {
    private static readonly tables = new Map<Function, TTableMeta>()

    private static ensure(ctor: Function): TTableMeta {
        let meta = this.tables.get(ctor)
        if (!meta) {
            meta = {
                modelCtor: ctor,
                tableName: '',
                paranoid: false,
                primaryKey: 'id',
                columns: [],
                relations: [],
            }
            this.tables.set(ctor, meta)
        }
        return meta
    }

    /**
     * Records the table name and table options for a model class, creating its entry when needed.
     *
     * Columns and relations already registered for the class are kept. `paranoid` falls back to
     * `false` when the options omit it.
     */
    static defineTable(ctor: Function, tableName: string, opts: TTableOptions = {}): void {
        const meta = this.ensure(ctor)
        meta.tableName = tableName
        meta.paranoid = opts.paranoid ?? false
    }

    /**
     * Appends a column to a model class, creating its entry when needed.
     *
     * A column carrying `options.primaryKey` becomes the model's primary key, and a column carrying
     * a `role` also becomes the model's `createdAt`, `updatedAt` or `deletedAt` key.
     */
    static defineColumn(ctor: Function, column: TColumnMeta): void {
        const meta = this.ensure(ctor)
        meta.columns.push(column)
        if (column.options.primaryKey) {
            meta.primaryKey = column.propertyKey
        }
        if (column.role) {
            this.setRoleKey(meta, column.role, column.propertyKey)
        }
    }

    /**
     * Marks a property as the model's `createdAt`, `updatedAt` or `deletedAt` column.
     *
     * The role key is recorded on the model whether or not a column is declared under that property
     * yet; when one is, it is tagged with the role as well.
     */
    static assignRole(ctor: Function, propertyKey: string, role: TColumnRole): void {
        const meta = this.ensure(ctor)
        const column = meta.columns.find(c => c.propertyKey === propertyKey)
        if (column) {
            column.role = role
        }
        this.setRoleKey(meta, role, propertyKey)
    }

    private static setRoleKey(meta: TTableMeta, role: TColumnRole, propertyKey: string): void {
        if (role === 'createdAt') {
            meta.createdAtKey = propertyKey
        } else if (role === 'updatedAt') {
            meta.updatedAtKey = propertyKey
        } else if (role === 'deletedAt') {
            meta.deletedAtKey = propertyKey
        }
    }

    /**
     * Adds a relation to a model class, creating its entry when needed.
     *
     * A relation already declared under the same `propertyKey` is merged with the new one rather
     * than duplicated, so the later declaration wins field by field.
     */
    static defineRelation(ctor: Function, relation: TRelationMeta): void {
        const meta = this.ensure(ctor)
        const existing = meta.relations.find(r => r.propertyKey === relation.propertyKey)
        if (existing) {
            Object.assign(existing, relation)
        } else {
            meta.relations.push(relation)
        }
    }

    /**
     * Returns the metadata collected for a model class, or `undefined` when it carries no decorators.
     *
     * @example
     * ```ts
     * ModelRegistry.get(Author)?.paranoid // false
     * ```
     */
    static get(ctor: Function): TTableMeta | undefined {
        return this.tables.get(ctor)
    }

    /**
     * Returns the metadata collected for a model class, insisting that the class is registered.
     *
     * @throws {Error} When the class carries no decorators and has no entry
     *
     * @example
     * ```ts
     * ModelRegistry.require(Author).primaryKey // 'id'
     * ```
     */
    static require(ctor: Function): TTableMeta {
        const meta = this.tables.get(ctor)
        if (!meta) {
            throw new Error(`Model ${ctor?.name ?? ctor} is not registered in ModelRegistry`)
        }
        return meta
    }

    /**
     * Returns the metadata of every registered model, in registration order.
     *
     * The array is a fresh copy, but the entries in it are the live metadata objects.
     *
     * @example
     * ```ts
     * ModelRegistry.all().map(m => m.tableName)
     * ```
     */
    static all(): TTableMeta[] {
        return [...this.tables.values()]
    }
}
