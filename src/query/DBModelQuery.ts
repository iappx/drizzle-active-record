import {
    aliasedTable,
    and,
    asc,
    desc,
    eq,
    exists,
    isNull,
    mapColumnsInSQLToAlias,
    max as sqlMax,
    min as sqlMin,
    or,
    SQL,
    sql,
} from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { Hydrator } from '../model/Hydrator'
import { Orm } from '../connection/Orm'
import { Tx } from '../connection/types'
import { TRelationMeta, TTableMeta } from '../types/metadata'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { RelationForeignKey } from '../schema/RelationForeignKey'
import { BoundValue } from './BoundValue'
import { ConditionBuilder } from './ConditionBuilder'
import { DBIncludeQuery } from './DBIncludeQuery'
import { PendingExists } from './PendingExists'
import { QueryExecutor } from './QueryExecutor'
import { QueryNode } from './QueryNode'
import { RelationNode } from './RelationNode'
import { TableRef } from './TableRef'
import {
    OrderItemColumn,
    TColumns,
    TIncludeOptions,
    TOrderByInput,
    TOrderItemPair,
    TRawInclude,
    TRawIncludeInput,
    TRelationExistsInput,
    TWhere,
    TWhereInput,
} from './types'

/**
 * The query builder behind `Model.query()`.
 *
 * Builder methods (`where`, `select`, `include`, `orderBy`, `limit`, ...) return the same instance
 * and accumulate state; execution methods (`getAll`, `getOne`, `count`, `update`, `delete`, ...)
 * finish the chain and talk to the database. Reads run through Drizzle's relational query builder,
 * except when `groupBy` is set, which switches to a flat select. Soft-deleted rows are excluded
 * automatically for a `paranoid` model.
 *
 * @example
 * ```ts
 * const authors = await Author.query()
 *     .where({ active: true })
 *     .includeModel(Book)
 *         .where({ status: 'published' })
 *     .endInclude()
 *     .orderBy('name')
 *     .limit(10)
 *     .getAll()
 * ```
 */
export class DBModelQuery<M> {
    /** Suffix of the alias the child of a self-referencing `required` include is given. */
    public static readonly ExistsAliasSuffix = '__exists'

    protected node: QueryNode = new QueryNode()
    protected tx?: Tx
    protected replica = false
    protected readonly meta: TTableMeta

    // exists() replays these: the built conditions already name this query's own table
    private readonly rawWhere: TWhere[] = []
    // neither can be replayed faithfully inside an EXISTS, so exists() refuses them
    private disjunctive = false
    private nestedExists = false

    /**
     * Opens a query over one model.
     *
     * @param modelCtor The model class this query reads from
     * @throws {Error} When the class carries no `@Table` metadata
     */
    constructor(protected modelCtor: new () => M) {
        this.meta = ModelRegistry.require(modelCtor)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected get table(): any {
        if (!this.meta.drizzleTable) {
            // fallback for entry points that never ran the bootstrap (tests/scripts)
            SchemaBuilder.build()
        }
        return this.meta.drizzleTable
    }

    /**
     * The underlying Drizzle column, for hand-written `sql` fragments.
     *
     * Resolves the property key first and the database column name second — the same lookup
     * `BaseModel.column()` and `TableRef.column()` perform.
     *
     * @throws {Error} When the model has no such column, naming the ones it does have
     *
     * @example
     * ```ts
     * const query = Author.query()
     * await query.where(sql`${query.column('meta')}->>'source' = 'import'`).getAll()
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public column(field: string): any {
        const column = this.resolveColumn(String(field))
        if (!column) {
            const known = this.meta.columns.map(c => `'${c.propertyKey}'`).join(', ')
            throw new Error(`Unknown column "${field}" on ${this.meta.tableName}. Known columns: ${known}.`)
        }
        return column
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private resolveColumn(key: string): any {
        if (this.table[key]) {
            return this.table[key]
        }
        const col = this.meta.columns.find(c => c.columnName === key || c.propertyKey === key)
        return col ? this.table[col.propertyKey] : undefined
    }

    /**
     * A `TableRef` bound to this query's own effective table — the real table, or the recursive
     * twin on a `RecursiveDBModelQuery`. Everything that needs to correlate a sub-query to "the
     * row this query is looking at" (`existsRelation` and friends) goes through this, so it works
     * the same whether the query is recursive or not.
     */
    public ref(): TableRef<M> {
        return TableRef.wrap<M>(this.table, this.meta)
    }

    /**
     * Adds conditions, ANDed with everything already accumulated.
     *
     * A plain object compares each key to its value — scalar as `=`, array as `IN`, `null` as
     * `IS NULL`, an `Op.*` wrapper as the operator it names. A ready `SQL` fragment goes in as it
     * is. A list of any of those is ANDed together, and `undefined` or an empty list adds nothing.
     * A `PendingExists` from another model's `exists()` becomes a correlated sub-query.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * await Author.query()
     *     .where({ name: 'Ann', age: Op.gte(18) })
     *     .where(sql`${Author.column('meta')}->>'source' = 'import'`)
     *     .getAll()
     * ```
     */
    public where(options: TWhereInput | PendingExists): this {
        if (options instanceof PendingExists) {
            this.node.where.push(this.resolveExists(options))
            this.nestedExists = true
            return this
        }
        this.recordRawWhere(options)
        this.node.where.push(...this.buildConditions(options))
        return this
    }

    /**
     * ORs these conditions against everything accumulated so far.
     *
     * Takes the same shapes as {@link where}. With nothing accumulated yet, or nothing to add, the
     * conditions are simply appended and no `OR` appears.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * await Author.query().where({ name: 'Ann' }).orWhere({ age: Op.gte(65) }).getAll()
     * ```
     */
    public orWhere(options: TWhereInput | PendingExists): this {
        this.disjunctive = true
        if (options instanceof PendingExists) {
            return this.orWhere(this.resolveExists(options))
        }
        const conditions = this.buildConditions(options)
        if (this.node.where.length && conditions.length) {
            const prev = this.node.where.length === 1 ? this.node.where[0] : (and(...this.node.where) as SQL)
            const next = conditions.length === 1 ? conditions[0] : (and(...conditions) as SQL)
            this.node.where = [or(prev, next) as SQL]
        } else {
            this.node.where.push(...conditions)
        }
        return this
    }

    private buildConditions(options: TWhereInput): SQL[] {
        return ConditionBuilder.fromWhere(this.table, options)
    }

    /**
     * `exists (select 1 from <this model> where <link to the outer row> and <this query's where>)`,
     * for the outer query's `where` — `outer.existsRelation({ model })` written from the other side.
     *
     * Only the conditions travel; a query that also selects, includes, orders or limits is refused
     * rather than silently stripped. `as` picks the relation, as in `include`.
     */
    public exists(opts?: { as?: string }): PendingExists {
        this.assertUsableAsExists()
        return new PendingExists(this.modelCtor, this.rawWhere, opts?.as)
    }

    /** The negation of {@link exists}. */
    public notExists(opts?: { as?: string }): PendingExists {
        return this.exists(opts).negate()
    }

    private resolveExists(pending: PendingExists): SQL {
        const relation = { model: pending.model, as: pending.as, where: pending.conditions }
        const ref = this.ref()
        return pending.negated ? ref.notExistsRelation({ relation }) : ref.existsRelation({ relation })
    }

    private recordRawWhere(options: TWhereInput): void {
        if (options === undefined) {
            return
        }
        const items = Array.isArray(options) ? options : [options]
        this.rawWhere.push(...items.filter(item => item !== undefined))
    }

    private assertUsableAsExists(): void {
        const carried: string[] = []
        if (this.disjunctive) {
            carried.push('orWhere')
        }
        if (this.nestedExists) {
            carried.push('a nested exists()')
        }
        if (this.node.columns || this.node.extras) {
            carried.push('select')
        }
        if (Object.keys(this.node.with).length || this.node.required.length) {
            carried.push('include')
        }
        if (this.node.orderBy.length) {
            carried.push('orderBy')
        }
        if (this.node.limit !== undefined || this.node.offset !== undefined) {
            carried.push('limit/offset')
        }
        if (carried.length) {
            throw new Error(
                `${this.meta.tableName}.query().exists() takes conditions only, but this query also carries `
                + `${carried.join(', ')}. Build the condition on the outer query with existsRelation() instead.`,
            )
        }
    }

    /**
     * Restricts the columns this query brings back, or adds computed ones.
     *
     * Takes a list of property keys, a `{ key: true }` map, or `{ extras }` for expressions that
     * are not columns of the model. Repeated calls merge; extras and columns are kept apart, so a
     * query can set both.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * await Author.query()
     *     .select(['id', 'name'])
     *     .select({ extras: { total: sql<number>`count(*)`.as('total') } })
     *     .getAll()
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public select(columns: string[] | TColumns | { extras: Record<string, any> }): this {
        if (Array.isArray(columns)) {
            this.node.columns = columns.reduce((acc, c) => ({ ...acc, [c]: true }), {} as TColumns)
        } else if ('extras' in columns && columns.extras) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.node.extras = { ...(this.node.extras ?? {}), ...(columns as { extras: Record<string, any> }).extras }
        } else {
            this.node.columns = { ...(this.node.columns ?? {}), ...(columns as TColumns) }
        }
        return this
    }

    /**
     * Every column of the model except the named ones. An unknown name throws — a column excluded
     * by a typo makes the row that comes back wrong rather than missing.
     */
    public selectExcept(exclude: string[]): this {
        const keys = this.meta.columns.map(column => column.propertyKey)
        const unknown = exclude.filter(key => !keys.includes(key))
        if (unknown.length) {
            throw new Error(
                `selectExcept: ${unknown.map(key => `"${key}"`).join(', ')} is not a column of `
                + `${this.meta.tableName}. Known columns: ${keys.map(key => `'${key}'`).join(', ')}.`,
            )
        }
        return this.select(keys.filter(key => !exclude.includes(key)))
    }

    /**
     * Loads relations alongside the rows, described as plain objects.
     *
     * An item is a bare model class, or `{ model, as?, where?, include?, required? }` — `as` picks
     * the relation when the model has several to the same target, `include` nests to any depth, and
     * `required: true` narrows the parent to rows that have a match, as a `WHERE EXISTS`. A
     * many-to-many relation is expanded through its junction table. Takes one item or a list.
     *
     * @returns The same query, for chaining
     * @throws {Error} When no relation matches the model or the `as` name
     *
     * @example
     * ```ts
     * await Author.query()
     *     .include([
     *         Tag,
     *         { model: Book, where: { status: 'published' }, required: true, include: [Review] },
     *     ])
     *     .getAll()
     * ```
     */
    public include(data: TRawIncludeInput | TRawIncludeInput[]): this {
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
            this.applyRawInclude(this.node, this.meta, DBModelQuery.normalizeInclude(item))
        }
        return this
    }

    private static normalizeInclude(item: TRawIncludeInput): TRawInclude {
        return typeof item === 'function' ? { model: item } : item
    }

    /**
     * Attaches a whole query builder as a relation branch.
     *
     * The branch carries its own `where`, `select`, `orderBy` and `limit`. `as` picks the relation
     * when the model has several to the same target; without it the first declared relation to that
     * model wins. `required: true` also narrows this query to rows that have a match. Takes one
     * query or a list.
     *
     * @returns The same query, for chaining
     * @throws {Error} When no relation matches the target model or the `as` name
     *
     * @example
     * ```ts
     * await Author.query()
     *     .includeQueryable(Book.query().where({ status: 'published' }), { as: 'books', required: true })
     *     .getAll()
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public includeQueryable(data: DBModelQuery<any> | DBModelQuery<any>[], options?: TIncludeOptions): this {
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
            // `as` has to reach the resolver: without it a model with two relations to the same
            // target silently attaches to whichever was declared first
            const rel = this.resolveRelation(item.modelCtor, options?.as)
            if (rel.kind === 'belongsToMany') {
                // the node stored at a m2m key is the *junction*; the incoming query describes the
                // target, so it has to be nested one level down — the same shape `include()` builds
                this.attachManyToMany(this.node, rel, item.node)
            } else {
                this.node.with[rel.propertyKey] = item.node
            }
            if (options?.required) {
                // recorded, not built: this query may itself end up attached under another one,
                // and only then is the table the EXISTS has to correlate to known
                this.node.required.push({ rel, childMeta: item.meta, childNode: item.node })
            }
        }
        return this
    }

    /**
     * The `EXISTS` sub-query behind `include({ required: true })`, returned as a condition instead
     * of applied.
     *
     * Builds `exists (select 1 from <related> where <foreign key link> [and <where>])`, correlated
     * to this query's table, with the join columns and the soft-delete check taken from the
     * relation metadata. The relation is addressed as in {@link include}: by target model, or by
     * `{ as }` when the model has several to the same target.
     *
     * @returns A condition to put into a `where`, an `or`, or a negation
     * @throws {Error} When no relation matches, or when the relation is many-to-many
     *
     * @example
     * ```ts
     * const query = Author.query()
     * await query
     *     .where(SqlConditions.anyOf([
     *         query.existsRelation({ model: Book, where: { status: 'published' } }),
     *         Op.is(true).build(query.column('active')),
     *     ]))
     *     .getAll()
     * ```
     */
    public existsRelation(data: TRelationExistsInput): SQL {
        const item = typeof data === 'function' ? { model: data } : data
        return this.ref().existsRelation({ relation: item })
    }

    private applyRawInclude(parentNode: QueryNode, parentMeta: TTableMeta, item: TRawInclude): void {
        const rel = this.findRelation(parentMeta, item)
        const childMeta = ModelRegistry.require(item.model ?? rel.target() as new () => unknown)
        const childNode = rel.kind === 'belongsToMany'
            ? this.attachManyToMany(parentNode, rel)
            : new QueryNode()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childTable = childMeta.drizzleTable as any
        childNode.where.push(...ConditionBuilder.fromWhere(childTable, item.where))
        for (const nested of item.include ?? []) {
            this.applyRawInclude(childNode, childMeta, DBModelQuery.normalizeInclude(nested))
        }
        // required => INNER JOIN semantics via WHERE EXISTS on the parent. Recorded, not built:
        // the table it correlates to is only known once the statement is assembled — see
        // TPendingRequired.
        if (rel.kind === 'belongsToMany') {
            if (item.required) {
                parentNode.required.push({ rel, childMeta, childNode })
            }
            return
        }
        parentNode.with[rel.propertyKey] = childNode

        if (item.required) {
            parentNode.required.push({ rel, childMeta, childNode })
        }
    }

    // `table` must be the branch's own (aliased) table: a nested branch is rendered as its own
    // sub-select, where the real table name is "invalid reference to FROM-clause entry"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildRequired(node: QueryNode, meta: TTableMeta | undefined, table: any, depth = 0): SQL[] {
        if (!meta) {
            return []
        }
        return node.required
            .map(item => this.buildExistsCondition(table, meta, item.childMeta, item.rel, item.childNode, depth))
            .filter((condition): condition is SQL => !!condition)
    }

    protected get rootAlias(): string {
        return this.meta.tableName
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findRelation(meta: TTableMeta, item: { model?: new () => any; as?: string }): TRelationMeta {
        const rel = item.as
            ? meta.relations.find(r => r.propertyKey === item.as)
            : meta.relations.find(r => r.target() === item.model)
        if (!rel) {
            throw new Error(`No relation from ${meta.tableName} to ${item.model?.name ?? item.as}`)
        }
        return rel
    }

    // `parentTable` must be the caller's effective table: on a `RecursiveDBModelQuery` the outer
    // FROM is the recursive twin, and `parentMeta.drizzleTable` yields legal but wrong SQL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildExistsCondition(parentTable: any, parentMeta: TTableMeta, childMeta: TTableMeta, rel: TRelationMeta, childNode: QueryNode, depth = 0): SQL | undefined {
        if (rel.kind === 'belongsToMany') {
            return this.buildManyToManyExists(parentTable, parentMeta, childMeta, rel, childNode, depth)
        }
        // without an alias a self-referencing relation compares the sub-query's own row with itself
        // — `where position.account_id = position.account_id`, true for every row
        const selfJoin = !!childMeta.drizzleTable && (childMeta.drizzleTable === parentTable || parentMeta === childMeta)
        // the depth keeps a chain that visits one table twice from aliasing both hops the same
        const alias = `${childMeta.tableName}${DBModelQuery.ExistsAliasSuffix}${depth || ''}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childTable = (selfJoin ? aliasedTable(childMeta.drizzleTable as any, alias) : childMeta.drizzleTable) as any

        const link = RelationForeignKey.linkCondition(parentTable, parentMeta, childTable, childMeta, rel)
        if (!link) {
            return undefined
        }
        // conditions were built against the real table; under an alias they have to follow it,
        // or they would silently filter the parent row instead of the child
        const scoped = selfJoin ? childNode.where.map(c => mapColumnsInSQLToAlias(c, alias)) : childNode.where
        // a `required` include nested under this one restricts the grandparent too, so its own
        // EXISTS travels into this sub-query, correlated to the table the sub-query reads from
        const nested = this.buildRequired(childNode, childMeta, childTable, depth + 1)
        const soft = this.softDeleteCondition(childMeta, childTable)
        const conditions = soft ? [...scoped, ...nested, soft] : [...scoped, ...nested]
        const where = conditions.length ? and(link, ...conditions) : link
        const sub = Orm.conn(this.tx).select({ e: sql`1` }).from(childTable).where(where)
        return exists(sub)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildManyToManyExists(parentTable: any, parentMeta: TTableMeta, targetMeta: TTableMeta, rel: TRelationMeta, childNode: QueryNode, depth: number): SQL | undefined {
        const throughCtor = rel.through?.()
        if (!throughCtor) {
            return undefined
        }
        const throughMeta = ModelRegistry.require(throughCtor)
        const targetRel = RelationForeignKey.junctionRelation(throughMeta, rel.target(), rel.otherKey)
        if (!targetRel || !throughMeta.drizzleTable || !targetMeta.drizzleTable) {
            return undefined
        }
        const junction = this.existsTable(throughMeta, parentTable, depth)
        const target = this.existsTable(targetMeta, parentTable, depth)

        const outerLink = RelationForeignKey.linkCondition(parentTable, parentMeta, junction.table, throughMeta, rel)
        const innerLink = RelationForeignKey.linkCondition(junction.table, throughMeta, target.table, targetMeta, targetRel)
        if (!outerLink || !innerLink) {
            return undefined
        }
        const scoped = target.alias
            ? childNode.where.map(c => mapColumnsInSQLToAlias(c, target.alias as string))
            : childNode.where
        const nested = this.buildRequired(childNode, targetMeta, target.table, depth + 1)
        const innerWhere = [innerLink, ...scoped, ...nested, this.softDeleteCondition(targetMeta, target.table)]
            .filter((c): c is SQL => !!c)
        const inner = exists(Orm.conn(this.tx).select({ e: sql`1` }).from(target.table).where(and(...innerWhere)))
        const outerWhere = [outerLink, this.softDeleteCondition(throughMeta, junction.table), inner]
            .filter((c): c is SQL => !!c)
        return exists(Orm.conn(this.tx).select({ e: sql`1` }).from(junction.table).where(and(...outerWhere)))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private existsTable(meta: TTableMeta, parentTable: any, depth: number): { table: any, alias?: string } {
        if (meta.drizzleTable !== parentTable) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { table: meta.drizzleTable as any }
        }
        const alias = `${meta.tableName}${DBModelQuery.ExistsAliasSuffix}${depth || ''}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { table: aliasedTable(meta.drizzleTable as any, alias), alias }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private softDeleteCondition(meta?: TTableMeta, table?: any): SQL | undefined {
        if (meta?.paranoid && meta.deletedAtKey && meta.drizzleTable) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return isNull((table ?? (meta.drizzleTable as any))[meta.deletedAtKey])
        }
        return undefined
    }

    /**
     * Adds ordering, accumulating across calls.
     *
     * Takes a column name, a raw `SQL` expression, a `[column, direction]` pair, or a list of any
     * of those. An entry with no direction sorts ascending. An empty list or a nullish `item` adds
     * no ordering. Inside a list an entry that starts with an array is a nested list and flattens.
     *
     * @throws {Error} When a column cannot be resolved — an unknown name, a wrong model prefix, or
     *     a path deeper than `Model.column` — or when the argument is none of the accepted shapes
     *
     * @example
     * ```ts
     * await Author.query()
     *     .orderBy('name')
     *     .orderBy([['createdAt', 'DESC'], [sql`lower(${Author.column('bio')})`, 'ASC']])
     *     .getAll()
     * ```
     */
    public orderBy(item: TOrderByInput, direction?: 'ASC' | 'DESC'): this {
        if (item instanceof SQL) {
            this.node.orderBy.push(direction ? DBModelQuery.withDirection(item, direction) : item)
        } else if (typeof item === 'string') {
            this.pushOrderBy(item, direction)
        } else if (Array.isArray(item)) {
            for (const entry of item) {
                this.pushOrderItem(entry)
            }
        } else if (item != null) {
            throw new Error(
                `Invalid orderBy argument on ${this.meta.tableName}: expected a column name, a SQL expression, `
                + `a [column, direction] pair or a list of those, got ${DBModelQuery.describe(item)}.`,
            )
        }
        return this
    }

    private pushOrderItem(entry: TOrderByInput): void {
        if (entry instanceof SQL) {
            this.node.orderBy.push(entry)
            return
        }
        if (typeof entry === 'string') {
            this.pushOrderBy(entry)
            return
        }
        if (Array.isArray(entry)) {
            // a `[column, direction]` pair never starts with an array, so this is a nested list —
            // which is how `[['title', 'ASC'], ...]` stays a list of pairs, not two columns
            if (Array.isArray(entry[0])) {
                for (const nested of entry) {
                    this.pushOrderItem(nested)
                }
            } else {
                this.pushOrderPair(entry as TOrderItemPair)
            }
            return
        }
        throw new Error(
            `Invalid orderBy item on ${this.meta.tableName}: expected a column name, a SQL expression `
            + `or a [column, direction] pair, got ${DBModelQuery.describe(entry)}.`,
        )
    }

    private pushOrderPair(pair: TOrderItemPair): void {
        const [column, dir] = pair
        if (column instanceof SQL) {
            this.node.orderBy.push(DBModelQuery.withDirection(column, dir))
            return
        }
        if (typeof column !== 'string') {
            throw new Error(
                `Invalid orderBy column on ${this.meta.tableName}: expected a column name or a SQL expression, `
                + `got ${DBModelQuery.describe(column)}.`,
            )
        }
        this.pushOrderBy(column, dir)
    }

    private pushOrderBy(field: string, direction?: string): void {
        const column = this.resolveOrderColumn(field)
        if (!column) {
            throw new Error(`Unknown orderBy column "${field}" on ${this.meta.tableName}.`)
        }
        this.node.orderBy.push(DBModelQuery.withDirection(column, direction))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static withDirection(column: any, direction?: string): SQL {
        return String(direction).toUpperCase() === 'DESC' ? desc(column) : asc(column)
    }

    private static describe(value: unknown): string {
        if (value === null || value === undefined) {
            return String(value)
        }
        return Array.isArray(value) ? 'an array' : typeof value
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private resolveOrderColumn(field: string): any {
        const parts = field.split('.')
        if (parts.length > 2) {
            return undefined
        }
        if (parts.length === 2 && parts[0] !== this.modelCtor.name) {
            return undefined
        }
        return this.resolveColumn(parts[parts.length - 1])
    }

    /**
     * Groups the result, which switches execution off the relational query builder onto a flat
     * select.
     *
     * Relations (`include`) are not available on a grouped query; `where`, `orderBy`, `limit` and
     * `offset` work as usual. Unlike {@link orderBy}, a column that cannot be resolved is dropped
     * silently.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * const duplicates = await Author.query()
     *     .select(['name'])
     *     .select({ extras: { total: sql<number>`count(*)`.as('total') } })
     *     .groupBy('name')
     *     .having(sql`count(*) > 1`)
     *     .getAll()
     * ```
     */
    public groupBy(columns: OrderItemColumn | OrderItemColumn[]): this {
        const items = Array.isArray(columns) ? columns : [columns]
        for (const item of items) {
            const column = item instanceof SQL ? item : this.resolveOrderColumn(item)
            if (column) {
                this.node.groupBy.push(column)
            }
        }
        return this
    }

    /**
     * Adds a condition applied after grouping. Repeated calls are ANDed together.
     *
     * @returns The same query, for chaining
     */
    public having(condition: SQL): this {
        this.node.having.push(condition)
        return this
    }

    /**
     * Caps the number of rows returned. A later call replaces the earlier one.
     *
     * @returns The same query, for chaining
     */
    public limit(value: number): this {
        this.node.limit = value
        return this
    }

    /**
     * Skips the first rows of the result. A later call replaces the earlier one.
     *
     * @returns The same query, for chaining
     */
    public offset(value: number): this {
        this.node.offset = value
        return this
    }

    /**
     * Runs this query on the connection an open Drizzle transaction holds.
     *
     * Passing `undefined` detaches the query and puts it back on the pool.
     *
     * @returns The same query, for chaining
     */
    public transaction(t?: Tx): this {
        this.tx = t
        return this
    }

    /**
     * Routes this read to the configured replica.
     *
     * Without a replica the query stays on the primary, as does one bound to a transaction.
     *
     * @returns The same query, for chaining
     */
    public useReplica(): this {
        this.replica = true
        return this
    }

    /**
     * Routes this read back to the primary, undoing {@link useReplica}.
     *
     * @returns The same query, for chaining
     */
    public useMaster(): this {
        this.replica = false
        return this
    }

    /**
     * Opens a typed sub-query on a relation, closed with `endInclude()`.
     *
     * The returned branch takes its own `where`, `select`, `orderBy`, `limit` and further
     * `includeModel` calls, and `endInclude()` returns this query. `as` picks the relation when the
     * model has several to the same target. A many-to-many relation is expanded through its
     * junction table, and the branch describes the target.
     *
     * @returns The branch builder for the relation
     * @throws {Error} When no relation matches the model or the `as` name
     *
     * @example
     * ```ts
     * await Author.query()
     *     .includeModel(Book)
     *         .where({ status: 'published' })
     *         .includeModel(Review).endInclude()
     *     .endInclude()
     *     .getAll()
     * ```
     */
    public includeModel<R>(relModel: new () => R, opts?: { as?: string }): DBIncludeQuery<R, this> {
        const targetNode = this.attachRelationNode(this.node, this.meta, relModel, opts?.as)
        return new DBIncludeQuery<R, this>(targetNode, ModelRegistry.require(relModel), this)
    }

    private attachRelationNode(parentNode: QueryNode, parentMeta: TTableMeta, relModel: new () => unknown, as?: string): QueryNode {
        const rel = as
            ? parentMeta.relations.find(r => r.propertyKey === as)
            : parentMeta.relations.find(r => r.target() === relModel)
        if (!rel) {
            throw new Error(`No relation from ${parentMeta.tableName} to ${relModel.name}. Pass { as } to disambiguate.`)
        }
        if (rel.kind === 'belongsToMany') {
            return this.attachManyToMany(parentNode, rel)
        }
        const childNode = new QueryNode()
        parentNode.with[rel.propertyKey] = childNode
        return childNode
    }

    private attachManyToMany(parentNode: QueryNode, rel: TRelationMeta, node?: QueryNode): QueryNode {
        return RelationNode.attachManyToMany(parentNode, rel, node)
    }

    private resolveRelation(relModel: new () => unknown, as?: string): TRelationMeta {
        const rel = as
            ? this.meta.relations.find(r => r.propertyKey === as)
            : this.meta.relations.find(r => r.target() === relModel)
        if (!rel) {
            if (as) {
                throw new Error(`No relation "${as}" on ${this.meta.tableName}.`)
            }
            throw new Error(`No relation from ${this.meta.tableName} to ${relModel.name}. Pass { as } to disambiguate.`)
        }
        return rel
    }

    /**
     * Runs the query and returns every matching row as a model instance.
     *
     * Returns an empty array when nothing matches. Columns that are not part of the model — the
     * `extras` of a grouped query — stay reachable through `getDataValue()`.
     *
     * @example
     * ```ts
     * const authors = await Author.query().where({ active: true }).orderBy('name').getAll()
     * ```
     */
    public async getAll(): Promise<M[]> {
        const rows = this.node.groupBy.length ? await this.runGroupedSelect() : await this.runFindMany()
        return Hydrator.hydrateMany(this.modelCtor, rows)
    }

    /**
     * The largest value of one column over the matching rows, as a single database aggregate.
     *
     * @returns The aggregate value, or `null` when nothing matches
     * @throws {Error} When the model has no such column
     */
    public async max<T = unknown>(field: string): Promise<T> {
        return this.aggregate<T>(sqlMax, field)
    }

    /**
     * The smallest value of one column over the matching rows, as a single database aggregate.
     *
     * @returns The aggregate value, or `null` when nothing matches
     * @throws {Error} When the model has no such column
     */
    public async min<T = unknown>(field: string): Promise<T> {
        return this.aggregate<T>(sqlMin, field)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async aggregate<T>(fn: (column: any) => SQL<any>, field: string): Promise<T> {
        const column = this.resolveOrderColumn(field)
        if (!column) {
            throw new Error(`Unknown column "${field}" on ${this.meta.tableName}`)
        }
        const rows = await QueryExecutor.run<{ value: T }[]>(() =>
            Orm.conn(this.tx, this.replica)
                .select({ value: fn(column) })
                .from(this.table)
                .where(this.whereCondition()),
        )
        return rows[0]?.value ?? (null as T)
    }

    /**
     * This query as a sub-select over one column, for embedding in another query's condition:
     * `(select <column> from <table> where <this query's where>)`. Defaults to the primary key.
     *
     * Returned as the Drizzle builder object, not as `SQL`, so that the relational query builder's
     * alias rewriting leaves the sub-select's own table alone. Bind parameters survive; nothing is
     * pre-compiled. `orderBy`, `limit` and `offset` carry over; includes are ignored, while soft
     * delete and `required` includes are folded into the condition.
     *
     * @throws {Error} When the model has no such column
     *
     * @example
     * ```ts
     * const published = Book.query().where({ status: 'published' })
     * await Author.query().where({ id: Op.in(published.asSubQuery('authorId')) }).getAll()
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public asSubQuery(column?: string): any {
        const key = column ?? this.meta.primaryKey
        const selected = this.resolveColumn(key)
        if (!selected) {
            const known = this.meta.columns.map(c => `'${c.propertyKey}'`).join(', ')
            throw new Error(`Unknown column "${key}" on ${this.meta.tableName}. Known columns: ${known}.`)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = Orm.conn(this.tx, this.replica).select({ [key]: selected }).from(this.table)
        const where = this.whereCondition()
        if (where) {
            query = query.where(where)
        }
        if (this.node.orderBy.length) {
            query = query.orderBy(...this.node.orderBy)
        }
        if (this.node.limit != null) {
            query = query.limit(this.node.limit)
        }
        if (this.node.offset != null) {
            query = query.offset(this.node.offset)
        }
        return query
    }

    protected whereCondition(): SQL | undefined {
        // this query is the outermost one on these paths (count, aggregates, the flat select),
        // so its own table is what a `required` include correlates to
        const conditions = [...this.node.where, ...this.buildRequired(this.node, this.meta, this.table)]
        const soft = this.softDeleteCondition(this.meta)
        if (soft) {
            conditions.push(soft)
        }
        return conditions.length ? and(...conditions) : undefined
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected buildFlatSelection(): Record<string, any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const selection: Record<string, any> = {}
        for (const col of this.meta.columns) {
            if (!this.node.columns || this.node.columns[col.propertyKey]) {
                selection[col.propertyKey] = this.table[col.propertyKey]
            }
        }
        for (const [key, value] of Object.entries(this.node.extras ?? {})) {
            selection[key] = value
        }
        return selection
    }

    private async runGroupedSelect(): Promise<Record<string, unknown>[]> {
        return QueryExecutor.run<Record<string, unknown>[]>(() => this.buildSelectQuery())
    }

    // `join` is spliced in right after FROM: before WHERE/GROUP BY/HAVING/ORDER BY/LIMIT/OFFSET,
    // or Postgres rejects the statement (42601)
    protected renderSelectSql(from?: SQL, join?: SQL): SQL {
        const parts: SQL[] = []
        const fields = Object.entries(this.buildFlatSelection()).map(([key, expr]) => {
            const alias = this.meta.columns.find(c => c.propertyKey === key)?.columnName ?? key
            // select extras arrive as SQL.Aliased; the alias is re-applied here
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inner = (expr as any)?.sql ?? expr
            return sql`${inner} as ${sql.identifier(alias)}`
        })
        parts.push(sql`select ${sql.join(fields, sql`, `)}`)
        parts.push(sql`from ${from ?? this.table}`)
        if (join) {
            parts.push(join)
        }
        const where = this.whereCondition()
        if (where) {
            parts.push(sql`where ${where}`)
        }
        if (this.node.groupBy.length) {
            parts.push(sql`group by ${sql.join(this.node.groupBy, sql`, `)}`)
        }
        if (this.node.having.length) {
            parts.push(sql`having ${and(...this.node.having)}`)
        }
        if (this.node.orderBy.length) {
            parts.push(sql`order by ${sql.join(this.node.orderBy, sql`, `)}`)
        }
        if (this.node.limit != null) {
            parts.push(sql`limit ${this.node.limit}`)
        }
        if (this.node.offset != null) {
            parts.push(sql`offset ${this.node.offset}`)
        }
        return sql.join(parts, sql` `)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected buildSelectQuery(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = Orm.conn(this.tx, this.replica).select(this.buildFlatSelection()).from(this.table)
        const where = this.whereCondition()
        if (where) {
            query = query.where(where)
        }
        query = query.groupBy(...this.node.groupBy)
        if (this.node.having.length) {
            query = query.having(this.node.having.length === 1 ? this.node.having[0] : and(...this.node.having))
        }
        if (this.node.orderBy.length) {
            query = query.orderBy(...this.node.orderBy)
        }
        if (this.node.limit != null) {
            query = query.limit(this.node.limit)
        }
        if (this.node.offset != null) {
            query = query.offset(this.node.offset)
        }
        return QueryExecutor.run<Record<string, unknown>[]>(() => query)
    }

    /**
     * Runs the query and returns the first matching row, or `null` when nothing matches.
     *
     * @example
     * ```ts
     * const author = await Author.query().where({ name: 'Ann' }).getOne()
     * ```
     */
    public async getOne(): Promise<M | null> {
        if (this.node.groupBy.length) {
            const rows = await this.limit(1).runGroupedSelect()
            return Hydrator.hydrate(this.modelCtor, rows[0])
        }
        const cfg = this.buildConfig(this.node, this.meta)
        const row = await QueryExecutor.run<Record<string, unknown>>(() => this.rqb().findFirst(cfg))
        return Hydrator.hydrate(this.modelCtor, row)
    }

    /**
     * Adds a primary-key equality to the accumulated conditions and returns the matching row.
     *
     * A `null` or `undefined` identifier returns `null` without issuing a statement.
     *
     * @returns The row, or `null` when nothing matches
     *
     * @example
     * ```ts
     * const author = await Author.query().getByPK(42)
     * ```
     */
    public async getByPK(identifier: unknown): Promise<M | null> {
        // no key matches NULL, so the round trip is skipped entirely
        if (identifier === null || identifier === undefined) {
            return null
        }
        const column = this.table[this.meta.primaryKey]
        this.node.where.push(eq(column, BoundValue.for(column, identifier)))
        return this.getOne()
    }

    /**
     * {@link getOne}, for a lookup that must find a row.
     *
     * @throws {Error} `ModelNotFoundError`, or whatever `Orm.init`'s `modelNotFoundErrorFactory`
     *     builds, when nothing matches
     */
    public async tryGetOne(): Promise<M> {
        const res = await this.getOne()
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    /**
     * {@link getByPK}, for a lookup that must find a row.
     *
     * @throws {Error} `ModelNotFoundError`, or whatever `Orm.init`'s `modelNotFoundErrorFactory`
     *     builds, when nothing matches — a nullish identifier included
     */
    public async tryFindByPk(identifier: unknown): Promise<M> {
        const res = await this.getByPK(identifier)
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    /**
     * The number of rows the accumulated conditions match, counted by the database.
     *
     * Soft-deleted rows and `required` includes are taken into account; loaded relations are not.
     *
     * @example
     * ```ts
     * const total = await Author.query().where({ active: true }).count()
     * ```
     */
    public async count(_distinct = true): Promise<number> {
        return Orm.conn(this.tx, this.replica).$count(this.meta.drizzleTable, this.whereCondition())
    }

    /**
     * Mass `UPDATE` over everything the accumulated `where` matches — the write counterpart of
     * {@link delete}. Only the top-level conditions are used: an include narrows what a `SELECT`
     * brings back, not what an `UPDATE` touches.
     *
     * Keys whose value is `undefined` are dropped: drizzle's own `set()` ignores them, so a patch
     * of nothing but `undefined` would reach the database as an empty `SET` clause and throw.
     * Nothing left to write means no statement at all.
     *
     * @example
     * ```ts
     * await Author.query().where({ id: 1 }).update({ name: 'Ann', age: undefined })
     * ```
     */
    public async update(values: Record<string, unknown>): Promise<void> {
        const definedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
        if (Object.keys(definedValues).length === 0) {
            return
        }
        const where = this.node.where.length ? and(...this.node.where) : undefined
        await QueryExecutor.run(() => Orm.conn(this.tx).update(this.meta.drizzleTable).set(definedValues).where(where))
    }

    /**
     * Mass `DELETE` over everything the accumulated `where` matches — the read counterpart of
     * {@link getAll}, narrowed the same way.
     *
     * A `paranoid` model is soft-deleted instead: the statement sets `deletedAt` to the current
     * time. Only the top-level conditions are used, so a query with no `where` clears the table.
     *
     * @example
     * ```ts
     * await Author.query().where({ active: false }).delete()
     * ```
     */
    public async delete(): Promise<void> {
        const where = this.node.where.length ? and(...this.node.where) : undefined
        if (this.meta.paranoid && this.meta.deletedAtKey) {
            await QueryExecutor.run(() => Orm.conn(this.tx).update(this.meta.drizzleTable).set({ [this.meta.deletedAtKey]: new Date() }).where(where))
        } else {
            await QueryExecutor.run(() => Orm.conn(this.tx).delete(this.meta.drizzleTable).where(where))
        }
    }

    /**
     * Compiles the read this query describes without executing it.
     *
     * @returns The statement text and its bound parameters
     *
     * @example
     * ```ts
     * const { sql, params } = Author.query().where({ name: 'Ann' }).toSQL()
     * ```
     */
    public toSQL(): { sql: string; params: unknown[] } {
        const cfg = this.buildConfig(this.node, this.meta)
        return this.rqb().findMany(cfg).toSQL()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected rqb(): any {
        return Orm.conn(this.tx, this.replica).query[this.meta.tableName]
    }

    private async runFindMany(): Promise<Record<string, unknown>[]> {
        const cfg = this.buildConfig(this.node, this.meta)
        return QueryExecutor.run<Record<string, unknown>[]>(() => this.rqb().findMany(cfg))
    }

    // a branch's alias follows the path that reaches it — `<parent alias>_<relation key>` — so it
    // can only be resolved here, walking down, and not while the include was attached
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected buildConfig(node: QueryNode, meta?: TTableMeta, table?: any, alias?: string): Record<string, unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ownTable = table ?? this.table
        const ownAlias = alias ?? this.rootAlias
        const withCfg: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(node.with)) {
            const rel = meta?.relations.find(r => r.propertyKey === key)
            // for m2m the child node is the junction (through), not the target
            const childCtor = rel && (rel.kind === 'belongsToMany' && rel.through ? rel.through() : rel.target())
            const childMeta = childCtor ? ModelRegistry.get(childCtor) : undefined
            const childAlias = `${ownAlias}_${key}`
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const childTable = childMeta?.drizzleTable
                ? aliasedTable(childMeta.drizzleTable as any, childAlias)
                : undefined
            withCfg[key] = this.buildConfig(child, childMeta, childTable, childAlias)
        }
        const conditions = [...node.where, ...this.buildRequired(node, meta, ownTable)]
        const soft = this.softDeleteCondition(meta)
        if (soft) {
            conditions.push(soft)
        }
        return {
            columns: node.columns,
            // a builder gets the branch's own (aliased) table, which is only known here
            extras: typeof node.extras === 'function'
                ? node.extras(meta ? TableRef.wrap(ownTable, meta) : ownTable)
                : node.extras,
            where: conditions.length ? and(...conditions) : undefined,
            orderBy: node.orderBy.length ? node.orderBy : undefined,
            limit: node.limit,
            offset: node.offset,
            with: Object.keys(withCfg).length ? withCfg : undefined,
        }
    }
}
