import { SQL, SQLWrapper } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { TableRef } from './TableRef'

/** Attributes of a loaded model instance, all optional. */
export type MAttributes<M> = Partial<M>

/** Attributes accepted when creating a row of a model. */
export type MCreationAttributes<M> = Record<string, unknown>

/** Something to sort by: a property key, or a raw `SQL` expression. */
export type OrderItemColumn = string | SQL

/** One entry of the array form of `orderBy` — the column may be a raw `SQL` expression. */
export type TOrderItemPair = [OrderItemColumn, string?]

/**
 * What `orderBy` accepts: one thing to sort by — a column name, a raw `SQL` expression or a
 * `[column, direction]` pair — or a list of them, nested lists included. `undefined` orders by
 * nothing.
 */
export type TOrderByInput = OrderItemColumn | TOrderItemPair | TOrderByInput[] | undefined

/** What a condition can be built against: a column, or any expression standing in for one. */
export type TConditionTarget = PgColumn | SQL | SQLWrapper

/** One condition: `{ column: value }` pairs, or a ready `SQL` fragment. */
export type TWhere = Record<string, unknown> | SQL

/**
 * What a `where` accepts: one condition, a list of them ANDed together, or nothing at all.
 *
 * `undefined` and an empty list both narrow nothing, so conditions assembled at runtime can be
 * passed straight through.
 */
export type TWhereInput = TWhere | TWhere[] | undefined

/** A column whitelist, keyed by property key. */
export type TColumns = Record<string, true>

/** Options of `includeQueryable` — which relation to attach a prepared query to, and how it joins. */
export type TIncludeOptions = {
    /**
     * Property key of the relation to attach the query to. Required as soon as the model has more
     * than one relation to the same target — without it the first matching relation wins, which
     * loads the wrong rows instead of failing.
     */
    as?: string
    /** Drops outer rows with no matching related row, as a `WHERE EXISTS`. */
    required?: boolean
}

/** The object form of an include: which relation to load, narrowed by `where` and nested `include`. */
export type TRawInclude = {
    /** Target model class of the relation, when one relation points at it. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model?: new () => any
    /** Property key of the relation, required when several relations share a target. */
    as?: string
    /**
     * Plain `{ column: value }` conditions, or a ready `SQL` fragment for anything an equality
     * cannot express — one of either, or a list of them ANDed together.
     */
    where?: TWhereInput
    /** Drops outer rows with no matching related row, as a `WHERE EXISTS`. */
    required?: boolean
    /**
     * Nested includes, addressed exactly like the top-level ones — a bare model class where the
     * relation needs no further options, the object form otherwise.
     */
    include?: TRawIncludeInput[]
}

/**
 * What `include` accepts for one relation: a bare model class, or the object form when the
 * relation needs options.
 *
 * @example
 * ```ts
 * const authors = await Author.query()
 *     .include([Tag, { model: Book, where: { isPublished: true }, required: true, include: [Review] }])
 *     .getAll()
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TRawIncludeInput = TRawInclude | (new () => any)

/**
 * Target of `DBModelQuery.existsRelation` — a relation is addressed exactly as in an include,
 * minus the parts that only mean something when rows are actually loaded (`required`, nested
 * `include`): the condition never selects the related rows, it only tests that one exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TRelationExistsInput = Omit<TRawInclude, 'required' | 'include'> | (new () => any)

/**
 * One hop of a relation path used by `TableRef`'s correlated sub-queries: a bare string is the
 * property key of the relation to follow (shorthand for `{ as }`); the object form additionally
 * takes `model` (address by target class instead, when there is only one relation to it) and a
 * per-hop `where` — plain `{ column: value }` conditions, or a ready `SQL` fragment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TRelationStep = string | { model?: new () => any; as?: string; where?: TWhereInput }

/**
 * A `TableRef` in the middle of a relation path — the last hop's alias is chosen by the library
 * (repeated tables get `__exists`, `__exists2`, ...), so a hand-written condition addresses it
 * through `scope` rather than by guessing a name.
 */
export type TRelationScope = {
    /** `TableRef` of the last hop of the path — what `column`, `existsRelation` etc. on it read from. */
    readonly ref: TableRef
    /** A column of the last hop, ready to build a condition against. */
    column(propertyKey: string): PgColumn
    /** `TableRef` of hop `index` (0-based) of a multi-step path. */
    hop(index: number): TableRef
    /** The `TableRef` the whole path correlates back to — a recursive twin on a recursive query. */
    readonly outer: TableRef
}

/**
 * Shared shape of `TableRef.existsRelation` / `notExistsRelation` / `valueOfRelation` /
 * `aggregateOfRelation` / `selectFromRelation`: which relation (or path of relations) to walk,
 * and what narrows the rows found at the far end.
 */
export type TCorrelatedOptions = {
    /** One relation, or a path of relations walked in order from this `TableRef`. */
    relation: TRelationStep | TRelationStep[]
    /**
     * Extra conditions on the last hop: plain `{ column: value }` conditions (possibly several,
     * ANDed together), or a callback with typed access to every hop of the path through `scope`.
     */
    where?: TWhereInput | ((scope: TRelationScope) => SQL)
    /** Ordering applied to the rows at the last hop — what decides which row `valueOfRelation` reads. */
    orderBy?: OrderItemColumn | TOrderItemPair[]
    /** Row cap on the last hop. */
    limit?: number
}

/**
 * Structural contract of "something `.column(propertyKey)` can be resolved against".
 *
 * Satisfied by `DBModelQuery`, `RecursiveDBModelQuery`, `TableRef` and any `QueryableModelCtor`, so
 * a filter that only needs a column to build a condition against takes any of them interchangeably.
 *
 * @example
 * ```ts
 * const publishedOnly = (source: IColumnSource): SQL => eq(source.column('isPublished'), true)
 * publishedOnly(Book.ref())
 * ```
 */
export interface IColumnSource {
    /** The drizzle column behind a property key, under this source's own alias. */
    column(propertyKey: string): PgColumn
}
