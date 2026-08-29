import { asc, desc, SQL } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { TTableMeta } from '../types/metadata'
import { ConditionBuilder } from './ConditionBuilder'
import { QueryNode, TExtrasBuilder } from './QueryNode'
import { RelationNode } from './RelationNode'
import { TColumns, TWhereInput } from './types'

/**
 * A branch of an include tree, opened by `includeModel` and closed by `endInclude`.
 *
 * Every builder method narrows the related rows only, and returns the branch itself so the calls
 * chain. `endInclude` hands the parent query back.
 *
 * @example
 * ```ts
 * const authors = await Author.query()
 *     .includeModel(Book)
 *         .where({ isPublished: true })
 *         .orderBy('rating', 'DESC')
 *         .limit(5)
 *     .endInclude()
 *     .getAll()
 * ```
 */
export class DBIncludeQuery<R, P> {
    /**
     * Binds a branch to the node it fills in, the metadata of the related model, and the query to
     * return from `endInclude`.
     */
    constructor(
        private readonly node: QueryNode,
        private readonly meta: TTableMeta,
        private readonly parent: P,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private get table(): any {
        return this.meta.drizzleTable
    }

    /**
     * Narrows the related rows of this branch.
     *
     * Conditions accumulate across calls and are ANDed together. They apply to the related table,
     * never to the outer one, and do not drop outer rows that have no match.
     *
     * @returns The same branch, for chaining
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .where({ isPublished: true })
     *         .where(gt(Book.column('rating'), 4))
     *     .endInclude()
     *     .getAll()
     * ```
     */
    public where(options: TWhereInput): this {
        this.node.where.push(...ConditionBuilder.fromWhere(this.table, options))
        return this
    }

    /**
     * Appends one ordering term to this branch, applied to the related rows only.
     *
     * @param key Property key of a column on the related model
     * @returns The same branch, for chaining
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .orderBy('rating', 'DESC')
     *         .orderBy('title')
     *     .endInclude()
     *     .getAll()
     * ```
     */
    public orderBy(key: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
        this.node.orderBy.push(direction === 'DESC' ? desc(this.table[key]) : asc(this.table[key]))
        return this
    }

    /**
     * Caps how many related rows this branch loads per outer row.
     *
     * @returns The same branch, for chaining
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .orderBy('rating', 'DESC')
     *         .limit(3)
     *     .endInclude()
     *     .getAll()
     * ```
     */
    public limit(value: number): this {
        this.node.limit = value
        return this
    }

    /**
     * Restricts this branch to a column whitelist, or gives it computed columns.
     *
     * A `{ extras }` builder is called with the branch's own `TableRef` while the statement is
     * assembled, which is the only point at which the branch's alias is known.
     *
     * @returns The same branch, for chaining
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .select(['id', 'title'])
     *     .endInclude()
     *     .getAll()
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public select(columns: string[] | { extras: TExtrasBuilder | Record<string, any> }): this {
        if (Array.isArray(columns)) {
            this.node.columns = columns.reduce((acc, c) => ({ ...acc, [c]: true }), {} as TColumns)
        } else {
            this.node.extras = columns.extras
        }
        return this
    }

    /**
     * Opens a nested branch on a relation of this branch's model.
     *
     * The relation is found by `as` when given, otherwise by the only relation pointing at
     * `relModel`. A `belongsToMany` relation is expanded through its junction on the way.
     *
     * @param opts.as Property key of the relation, required when several relations share a target
     * @returns The nested branch, closed with its own `endInclude`
     * @throws {Error} When this branch's model declares no such relation
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .includeModel(Review, { as: 'reviews' })
     *             .where({ isApproved: true })
     *         .endInclude()
     *     .endInclude()
     *     .getAll()
     * ```
     */
    public includeModel<R2>(relModel: new () => R2, opts?: { as?: string }): DBIncludeQuery<R2, this> {
        // resolve by `as` first so a model with several relations to one target lands on the right
        // one, and so `rel.kind` is available even when the caller addressed the relation by name
        const rel = opts?.as
            ? this.meta.relations.find(r => r.propertyKey === opts.as)
            : this.meta.relations.find(r => r.target() === relModel)
        if (!rel) {
            throw new Error(`No relation from ${this.meta.tableName} to ${opts?.as ?? relModel.name}`)
        }
        const childNode = new QueryNode()
        if (rel.kind === 'belongsToMany') {
            // the node at a m2m key is the junction; the target hangs one level below it
            RelationNode.attachManyToMany(this.node, rel, childNode)
        } else {
            this.node.with[rel.propertyKey] = childNode
        }
        return new DBIncludeQuery<R2, this>(childNode, ModelRegistry.require(relModel), this)
    }

    /**
     * Closes this branch and returns the query or branch it was opened on.
     *
     * @example
     * ```ts
     * const authors = await Author.query()
     *     .includeModel(Book)
     *         .where({ isPublished: true })
     *     .endInclude()
     *     .orderBy('name')
     *     .getAll()
     * ```
     */
    public endInclude(): P {
        return this.parent
    }

    /**
     * Closes this branch when `condition` holds, and stays on it otherwise.
     *
     * Lets a chain built from a flag close the branch or keep filling it.
     *
     * @example
     * ```ts
     * const query = Author.query()
     * const books = query.includeModel(Book)
     * books.conditionalEndInclude(true)  // query
     * books.conditionalEndInclude(false) // books
     * ```
     */
    public conditionalEndInclude(condition: boolean): P | this {
        return condition ? this.parent : this
    }
}
