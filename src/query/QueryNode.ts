import { SQL } from 'drizzle-orm'
import { TRelationMeta, TTableMeta } from '../types/metadata'
import { TColumns } from './types'

/**
 * A `required` include, recorded until the statement is assembled and it becomes a `WHERE EXISTS`.
 *
 * The condition correlates to the alias of the parent branch, which is settled only once the
 * whole statement is rendered.
 */
export type TPendingRequired = {
    /** Relation the include was attached to. */
    rel: TRelationMeta
    /** Metadata of the related model the sub-query reads from. */
    childMeta: TTableMeta
    /** Node holding the conditions the sub-query applies. */
    childNode: QueryNode
}

/**
 * Computed columns of a branch, built from the branch's own `TableRef`.
 *
 * The builder is called while the statement is assembled, which is the only point at which the
 * branch's alias is known.
 *
 * @example
 * ```ts
 * const extras: TExtrasBuilder = scope => ({
 *     reviewCount: scope.aggregateOfRelation({ relation: 'reviews', fn: 'count' }).as('review_count'),
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TExtrasBuilder = (scope: any) => Record<string, any>

/**
 * One branch of a query, collected by the builders and rendered when the statement is assembled.
 *
 * A fresh node selects every column of its table and carries no conditions; the root node of a
 * query and every include branch are nodes of the same shape, nested through `with`.
 */
export class QueryNode {
    /** Column whitelist for this branch. Every column is read when unset. */
    public columns?: TColumns

    /** Computed columns, ready as expressions or as a builder called with the branch's `TableRef`. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public extras?: Record<string, any> | TExtrasBuilder

    /** Conditions on this branch's rows, ANDed together. */
    public where: SQL[] = []

    /** Ordering terms, applied in the order they were added. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public orderBy: (SQL | any)[] = []

    /** Row cap for this branch — per outer row on an include branch. */
    public limit?: number

    /** Rows skipped before the first one read. */
    public offset?: number

    /** Grouping terms. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public groupBy: (SQL | any)[] = []

    /** Conditions on the groups, ANDed together. */
    public having: SQL[] = []

    /** Nested branches by relation property key. */
    public with: Record<string, QueryNode> = {}

    /** Includes marked `required`, awaiting the `WHERE EXISTS` built at assembly time. */
    public required: TPendingRequired[] = []
}
