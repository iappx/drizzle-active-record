import { asc, desc, SQL } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { TTableMeta } from '../types/metadata'
import { ConditionBuilder } from './ConditionBuilder'
import { QueryNode } from './QueryNode'
import { TColumns, TWhere } from './types'

export class DBIncludeQuery<R, P> {
    constructor(
        private readonly node: QueryNode,
        private readonly meta: TTableMeta,
        private readonly parent: P,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private get table(): any {
        return this.meta.drizzleTable
    }

    public where(options: TWhere): this {
        if (options instanceof SQL) {
            this.node.where.push(options)
        } else {
            for (const [key, value] of Object.entries(options)) {
                this.node.where.push(ConditionBuilder.fromValue(this.table[key], value))
            }
        }
        return this
    }

    public orderBy(key: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
        this.node.orderBy.push(direction === 'DESC' ? desc(this.table[key]) : asc(this.table[key]))
        return this
    }

    public limit(value: number): this {
        this.node.limit = value
        return this
    }

    public select(columns: string[]): this {
        this.node.columns = columns.reduce((acc, c) => ({ ...acc, [c]: true }), {} as TColumns)
        return this
    }

    public includeModel<R2>(relModel: new () => R2, opts?: { as?: string }): DBIncludeQuery<R2, this> {
        const rel = this.meta.relations.find(r => r.target() === relModel)
        const relKey = opts?.as ?? rel?.propertyKey
        if (!relKey) {
            throw new Error(`No relation from ${this.meta.tableName} to ${relModel.name}`)
        }
        const childNode = new QueryNode()
        this.node.with[relKey] = childNode
        return new DBIncludeQuery<R2, this>(childNode, ModelRegistry.require(relModel), this)
    }

    public endInclude(): P {
        return this.parent
    }

    public conditionalEndInclude(condition: boolean): P | this {
        return condition ? this.parent : this
    }
}
