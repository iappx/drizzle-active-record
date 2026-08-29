import { BaseModel, TColumnKey } from './BaseModel'
import { DBModelQuery } from '../query/DBModelQuery'
import type { TableRef } from '../query/TableRef'

/**
 * The class application models extend: a `BaseModel` that adds no members of its own and whose
 * statics stay reachable when the class itself is passed around, typed as `QueryableModelCtor`.
 *
 * `M` is the model type, `CA` the attribute set `create()` and `update()` accept.
 *
 * @example
 * ```ts
 * class Author extends QueryableModel<Author, { name: string }> {
 *     id: number
 *     name: string
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class QueryableModel<M extends BaseModel = any, CA extends object = any> extends BaseModel<M, CA> {
}

/**
 * The constructor of a `QueryableModel`, with its static query and write API spelled out.
 *
 * This is the type to accept wherever a model class is handed over as a value rather than used
 * directly, so the statics survive the trip.
 *
 * @example
 * ```ts
 * const loadAll = async <M extends QueryableModel>(model: QueryableModelCtor<M>): Promise<M[]> =>
 *     model.query().getAll()
 *
 * const authors = await loadAll(Author)
 * ```
 */
export type QueryableModelCtor<M extends QueryableModel = QueryableModel> = (new () => M) & {
    /** Opens a query builder over the model's table. */
    query(): DBModelQuery<M>
    /** Inserts one row and returns it hydrated. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(attrs: any, opts?: any): Promise<M>
    /** Inserts many rows in one statement and returns them hydrated; an empty input writes nothing. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkCreate(attrs: any[], opts?: any): Promise<M[]>
    /** Deletes every row matching `where`, or stamps the deleted column when the model is `paranoid`. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destroy(opts: { where: any; transaction?: any }): Promise<void>
    /** Writes `values` to every row matching `where`, without loading any of them. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(values: Record<string, unknown>, opts: { where: any; transaction?: any }): Promise<void>
    /** Builds an instance from a raw database row, or `null` when the row is missing. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hydrate(row: any): M | null
    /** Creates an unsaved instance with every given field marked as changed. */
    build(attrs: object): M
    /** The underlying drizzle column, for raw `sql` fragments built outside a query chain. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column(propertyKey: TColumnKey<M>): any
    /** A `TableRef` to this model's own table, for correlated sub-queries built without a query in hand. */
    ref(opts?: { as?: string; recursive?: boolean }): TableRef<M>
    /** Property key of the primary key column. */
    primaryKeyAttribute: string
}
