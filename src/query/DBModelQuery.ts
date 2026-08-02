import { and, asc, desc, eq, exists, isNull, or, SQL, sql } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { Hydrator } from '../model/Hydrator'
import { Orm } from '../connection/Orm'
import { Tx } from '../connection/types'
import { TRelationMeta, TTableMeta } from '../types/metadata'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { ConditionBuilder } from './ConditionBuilder'
import { DBIncludeQuery } from './DBIncludeQuery'
import { QueryExecutor } from './QueryExecutor'
import { QueryNode } from './QueryNode'
import { OrderItemColumn, TColumns, TIncludeOptions, TRawInclude, TRawIncludeInput, TWhere } from './types'

export class DBModelQuery<M> {
    protected node: QueryNode = new QueryNode()
    protected tx?: Tx
    protected readonly meta: TTableMeta

    constructor(protected modelCtor: new () => M) {
        this.meta = ModelRegistry.require(modelCtor)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private get table(): any {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childTable = childMeta.drizzleTable as any

        let link: SQL | undefined
        if (rel.kind === 'hasMany' || rel.kind === 'belongsToMany') {
            const fkCol = childMeta.columns.find(c => c.foreignKeyTarget && c.foreignKeyTarget() === parentMeta.modelCtor)
            if (fkCol) {
                link = eq(childTable[fkCol.propertyKey], parentTable[parentMeta.primaryKey])
            }
        } else {
            const fkCol = parentMeta.columns.find(c => c.foreignKeyTarget && c.foreignKeyTarget() === childMeta.modelCtor)
            if (fkCol) {
                link = eq(childTable[childMeta.primaryKey], parentTable[fkCol.propertyKey])
            }
        }
        if (!link) {
            return undefined
        }
        const soft = this.softDeleteCondition(childMeta)
        const conditions = soft ? [...extra, soft] : extra
        const where = conditions.length ? and(link, ...conditions) : link
        const sub = Orm.conn(this.tx).select({ e: sql`1` }).from(childTable).where(where)
        return exists(sub)
    }

    private softDeleteCondition(meta?: TTableMeta): SQL | undefined {
        if (meta?.paranoid && meta.deletedAtKey && meta.drizzleTable) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return isNull((meta.drizzleTable as any)[meta.deletedAtKey])
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
        const targetRel = throughMeta.relations.find(r => r.target() === targetCtor)
        if (!targetRel) {
            throw new Error(`Junction ${throughMeta.tableName} has no belongsTo relation to ${(targetCtor as { name?: string }).name}`)
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
        const rows = await this.runFindMany()
        return Hydrator.hydrateMany(this.modelCtor, rows)
    }

    public async getOne(): Promise<M | null> {
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
        const conditions = [...this.node.where]
        const soft = this.softDeleteCondition(this.meta)
        if (soft) {
            conditions.push(soft)
        }
        const where = conditions.length ? and(...conditions) : undefined
        return Orm.conn(this.tx).$count(this.meta.drizzleTable, where)
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
    private rqb(): any {
        return Orm.conn(this.tx).query[this.meta.tableName]
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
