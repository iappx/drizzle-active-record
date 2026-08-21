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
import { ConditionBuilder } from './ConditionBuilder'
import { DBIncludeQuery } from './DBIncludeQuery'
import { QueryExecutor } from './QueryExecutor'
import { QueryNode } from './QueryNode'
import { OrderItemColumn, TColumns, TIncludeOptions, TRawInclude, TRawIncludeInput, TWhere } from './types'

export class DBModelQuery<M> {
    /** Suffix of the alias the child of a self-referencing `required` include is given. */
    public static readonly ExistsAliasSuffix = '__exists'

    protected node: QueryNode = new QueryNode()
    protected tx?: Tx
    // reads go to the write connection unless the caller opts into the replica
    protected replica = false
    protected readonly meta: TTableMeta

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public column(field: string): any {
        return this.table[field]
    }

    public where(options: TWhere): this {
        this.node.where.push(...this.buildConditions(options))
        return this
    }

    public orWhere(options: TWhere): this {
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

    private buildConditions(options: TWhere): SQL[] {
        if (options instanceof SQL) {
            return [options]
        }
        return Object.entries(options).map(([key, value]) => ConditionBuilder.fromValue(this.table[key], value))
    }

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

    public include(data: TRawIncludeInput | TRawIncludeInput[]): this {
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
            const normalized: TRawInclude = typeof item === 'function' ? { model: item } : item
            this.applyRawInclude(this.node, this.meta, normalized)
        }
        return this
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public includeQueryable(data: DBModelQuery<any> | DBModelQuery<any>[], options?: TIncludeOptions): this {
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
            const relKey = this.resolveRelationKey(item.modelCtor)
            this.node.with[relKey] = item.node
            if (options?.required) {
                const rel = this.meta.relations.find(r => r.propertyKey === relKey)
                const cond = rel && this.buildExistsCondition(this.meta, item.meta, rel, item.node.where)
                if (cond) {
                    this.node.where.push(cond)
                }
            }
        }
        return this
    }

    private applyRawInclude(parentNode: QueryNode, parentMeta: TTableMeta, item: TRawInclude): void {
        const rel = item.as
            ? parentMeta.relations.find(r => r.propertyKey === item.as)
            : parentMeta.relations.find(r => r.target() === item.model)
        if (!rel) {
            throw new Error(`No relation from ${parentMeta.tableName} to ${item.model?.name ?? item.as}`)
        }
        const childMeta = ModelRegistry.require(item.model ?? rel.target() as new () => unknown)
        const childNode = rel.kind === 'belongsToMany'
            ? this.attachManyToMany(parentNode, rel)
            : new QueryNode()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childTable = childMeta.drizzleTable as any
        if (item.where) {
            for (const [key, value] of Object.entries(item.where)) {
                childNode.where.push(ConditionBuilder.fromValue(childTable[key], value))
            }
        }
        for (const nested of item.include ?? []) {
            this.applyRawInclude(childNode, childMeta, nested)
        }
        if (rel.kind === 'belongsToMany') {
            return
        }
        parentNode.with[rel.propertyKey] = childNode

        // required => INNER JOIN semantics via WHERE EXISTS on the parent
        if (item.required) {
            const cond = this.buildExistsCondition(parentMeta, childMeta, rel, childNode.where)
            if (cond) {
                parentNode.where.push(cond)
            }
        }
    }

    private buildExistsCondition(parentMeta: TTableMeta, childMeta: TTableMeta, rel: TRelationMeta, extra: SQL[]): SQL | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parentTable = parentMeta.drizzleTable as any
        // A self-referencing relation would otherwise compare the subquery's own row with itself —
        // `WHERE position.account_id = position.account_id`, true for every row and correlated to
        // nothing. The child side gets an alias so the parent row stays reachable.
        const selfJoin = !!childMeta.drizzleTable && childMeta.drizzleTable === parentMeta.drizzleTable
        const alias = `${childMeta.tableName}${DBModelQuery.ExistsAliasSuffix}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childTable = (selfJoin ? aliasedTable(childMeta.drizzleTable as any, alias) : childMeta.drizzleTable) as any

        let link: SQL | undefined
        if (rel.kind === 'hasMany' || rel.kind === 'belongsToMany') {
            // the foreign key lives on the child and points back at the parent
            const fkCol = RelationForeignKey.find(childMeta, parentMeta.modelCtor, rel.foreignKey)
            if (fkCol) {
                link = eq(childTable[fkCol.propertyKey], parentTable[RelationForeignKey.findReferencedKey(parentMeta, rel)])
            }
        } else {
            const fkCol = RelationForeignKey.find(parentMeta, childMeta.modelCtor, rel.foreignKey)
            if (fkCol) {
                link = eq(childTable[RelationForeignKey.findReferencedKey(childMeta, rel)], parentTable[fkCol.propertyKey])
            }
        }
        if (!link) {
            return undefined
        }
        // conditions were built against the real table; under an alias they have to follow it,
        // or they would silently filter the parent row instead of the child
        const scoped = selfJoin ? extra.map(c => mapColumnsInSQLToAlias(c, alias)) : extra
        const soft = this.softDeleteCondition(childMeta, childTable)
        const conditions = soft ? [...scoped, soft] : scoped
        const where = conditions.length ? and(link, ...conditions) : link
        const sub = Orm.conn(this.tx).select({ e: sql`1` }).from(childTable).where(where)
        return exists(sub)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private softDeleteCondition(meta?: TTableMeta, table?: any): SQL | undefined {
        if (meta?.paranoid && meta.deletedAtKey && meta.drizzleTable) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return isNull((table ?? (meta.drizzleTable as any))[meta.deletedAtKey])
        }
        return undefined
    }

    public orderBy(item: OrderItemColumn | [string, string][], direction?: 'ASC' | 'DESC'): this {
        if (direction && typeof item === 'string') {
            this.pushOrderBy(item, direction)
        } else if (item instanceof SQL) {
            this.node.orderBy.push(item)
        } else if (Array.isArray(item)) {
            for (const [col, dir] of item) {
                this.pushOrderBy(col, dir)
            }
        }
        return this
    }

    private pushOrderBy(field: string, direction: string): void {
        const column = this.resolveOrderColumn(field)
        if (!column) {
            return
        }
        this.node.orderBy.push(String(direction).toUpperCase() === 'DESC' ? desc(column) : asc(column))
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
        const segment = parts[parts.length - 1]
        if (this.table[segment]) {
            return this.table[segment]
        }
        const col = this.meta.columns.find(c => c.columnName === segment || c.propertyKey === segment)
        return col ? this.table[col.propertyKey] : undefined
    }

    // grouping switches execution off the relational query builder onto a flat select:
    // RQB cannot express GROUP BY, and grouped rows are no longer whole entities
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

    public having(condition: SQL): this {
        this.node.having.push(condition)
        return this
    }

    public limit(value: number): this {
        this.node.limit = value
        return this
    }

    public offset(value: number): this {
        this.node.offset = value
        return this
    }

    public transaction(t?: Tx): this {
        this.tx = t
        return this
    }

    // routes this query to the read replica; without a configured replica it stays on the primary
    public useReplica(): this {
        this.replica = true
        return this
    }

    public useMaster(): this {
        this.replica = false
        return this
    }

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

    // m2m has no one-hop RQB support: nest target under the junction node, return the target node
    private attachManyToMany(parentNode: QueryNode, rel: TRelationMeta): QueryNode {
        if (!rel.through) {
            throw new Error(`belongsToMany relation "${rel.propertyKey}" has no through model`)
        }
        const throughMeta = ModelRegistry.require(rel.through())
        const targetCtor = rel.target()
        const targetRel = RelationForeignKey.junctionRelation(throughMeta, targetCtor, rel.otherKey)
        if (!targetRel) {
            const via = rel.otherKey ? ` on column "${rel.otherKey}" (from { otherKey })` : ''
            throw new Error(
                `Junction ${throughMeta.tableName} has no belongsTo relation to `
                + `${(targetCtor as { name?: string }).name}${via}`,
            )
        }
        const targetNode = new QueryNode()
        const junctionNode = new QueryNode()
        junctionNode.with[targetRel.propertyKey] = targetNode
        parentNode.with[rel.propertyKey] = junctionNode
        return targetNode
    }

    private resolveRelationKey(relModel: new () => unknown, as?: string): string {
        if (as) {
            return as
        }
        const rel = this.meta.relations.find(r => r.target() === relModel)
        if (!rel) {
            throw new Error(`No relation from ${this.meta.tableName} to ${relModel.name}. Pass { as } to disambiguate.`)
        }
        return rel.propertyKey
    }

    public async getAll(): Promise<M[]> {
        const rows = this.node.groupBy.length ? await this.runGroupedSelect() : await this.runFindMany()
        return Hydrator.hydrateMany(this.modelCtor, rows)
    }

    public async max<T = unknown>(field: string): Promise<T> {
        return this.aggregate<T>(sqlMax, field)
    }

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

    protected whereCondition(): SQL | undefined {
        const conditions = [...this.node.where]
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

    // A hand-rendered flat SELECT. Columns keep the names they have in the database, so the
    // result of one of these can stand in for the table itself — which is what a recursive CTE
    // relies on when it unions two terms and is then read like an ordinary table.
    protected renderSelectSql(from?: SQL): SQL {
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

    // the flat (non-RQB) form of this query: grouping and recursive CTEs both build on it
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

    public async getOne(): Promise<M | null> {
        if (this.node.groupBy.length) {
            const rows = await this.limit(1).runGroupedSelect()
            return Hydrator.hydrate(this.modelCtor, rows[0])
        }
        const cfg = this.buildConfig(this.node, this.meta)
        const row = await QueryExecutor.run<Record<string, unknown>>(() => this.rqb().findFirst(cfg))
        return Hydrator.hydrate(this.modelCtor, row)
    }

    public async getByPK(identifier: unknown): Promise<M | null> {
        this.node.where.push(eq(this.table[this.meta.primaryKey], identifier))
        return this.getOne()
    }

    public async tryGetOne(): Promise<M> {
        const res = await this.getOne()
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    public async tryFindByPk(identifier: unknown): Promise<M> {
        const res = await this.getByPK(identifier)
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    public async count(_distinct = true): Promise<number> {
        return Orm.conn(this.tx, this.replica).$count(this.meta.drizzleTable, this.whereCondition())
    }

    public async delete(): Promise<void> {
        const where = this.node.where.length ? and(...this.node.where) : undefined
        if (this.meta.paranoid && this.meta.deletedAtKey) {
            await Orm.conn(this.tx).update(this.meta.drizzleTable).set({ [this.meta.deletedAtKey]: new Date() }).where(where)
        } else {
            await Orm.conn(this.tx).delete(this.meta.drizzleTable).where(where)
        }
    }

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

    protected buildConfig(node: QueryNode, meta?: TTableMeta): Record<string, unknown> {
        const withCfg: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(node.with)) {
            const rel = meta?.relations.find(r => r.propertyKey === key)
            // for m2m the child node is the junction (through), not the target
            const childCtor = rel && (rel.kind === 'belongsToMany' && rel.through ? rel.through() : rel.target())
            const childMeta = childCtor ? ModelRegistry.get(childCtor) : undefined
            withCfg[key] = this.buildConfig(child, childMeta)
        }
        const conditions = [...node.where]
        const soft = this.softDeleteCondition(meta)
        if (soft) {
            conditions.push(soft)
        }
        return {
            columns: node.columns,
            extras: node.extras,
            where: conditions.length ? and(...conditions) : undefined,
            orderBy: node.orderBy.length ? node.orderBy : undefined,
            limit: node.limit,
            offset: node.offset,
            with: Object.keys(withCfg).length ? withCfg : undefined,
        }
    }
}
