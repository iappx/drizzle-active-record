import {
    aliasedTable,
    and,
    asc,
    avg,
    count,
    desc,
    exists,
    getTableName,
    isNull,
    mapColumnsInSQLToAlias,
    max,
    min,
    sql,
    sum,
    SQL,
} from 'drizzle-orm'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { ModelRegistry } from '../registry/ModelRegistry'
import { Orm } from '../connection/Orm'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { RelationForeignKey } from '../schema/RelationForeignKey'
import { ConditionBuilder } from './ConditionBuilder'
import { SqlConditions } from '../filter/SqlConditions'
import { TTableMeta } from '../types/metadata'
import type { TColumnKey } from '../model/BaseModel'
import {
    OrderItemColumn,
    TCorrelatedOptions,
    TOrderItemPair,
    TRelationScope,
    TRelationStep,
    TWhereInput,
} from './types'

/**
 * A reference to one table in play in a query — the real table, the recursive twin a
 * `RecursiveDBModelQuery` selects from, or an aliased copy of either, taken by a hop of a
 * correlated relation path. Everything that needs to say "this column, on this particular
 * appearance of the table" goes through one of these instead of a bare table name.
 *
 * `TableRef.of(Model)` / `Model.ref()` builds one from a model class; `DBModelQuery.ref()` /
 * `RecursiveDBModelQuery.ref()` builds one bound to a query's own effective table, so the same
 * call correlates to the real table on an ordinary query and to the twin on a recursive one.
 */
export class TableRef<M = unknown> {
    /** Suffix given to the alias of a table that repeats along a relation path (self-joins included). */
    public static readonly ExistsAliasSuffix = '__exists'

    private constructor(
        /** Registry metadata of the model behind this reference — table name, columns, relations. */
        public readonly meta: TTableMeta,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        private readonly drizzleTable: any,
        private readonly physicalName: string,
        /** The alias this reference reads under, set only by `.of(Model, { as })`. */
        public readonly alias?: string,
    ) {}

    /**
     * A `TableRef` to a model's own table — the real one, or its recursive twin with `{ recursive: true }`.
     *
     * @throws {Error} When the model has no built table, or no twin under `{ recursive: true }`
     *
     * @example
     * ```ts
     * TableRef.of(Author)                          // "authors"
     * TableRef.of(Author, { as: 'a2' })            // "authors" "a2"
     * TableRef.of(Category, { recursive: true })   // "categories__recursive"
     * ```
     */
    static of<M>(model: new () => M, opts?: { as?: string; recursive?: boolean }): TableRef<M> {
        const meta = ModelRegistry.require(model)
        if (!meta.drizzleTable) {
            // same fallback the query builder uses for entry points that never ran the bootstrap
            SchemaBuilder.build()
        }
        const base = opts?.recursive ? meta.recursiveTable : meta.drizzleTable
        if (!base) {
            const what = opts?.recursive ? 'recursive twin' : 'table'
            throw new Error(`Model ${(model as { name?: string }).name ?? meta.tableName} has no ${what} to reference yet.`)
        }
        const physicalName = opts?.recursive ? SchemaBuilder.recursiveTableName(meta) : meta.tableName
        const table = opts?.as ? aliasedTable(base, opts.as) : base
        return new TableRef<M>(meta, table, physicalName, opts?.as)
    }

    /**
     * Wraps a query's own effective table — the `step` a recursive query's `.on()` callback
     * receives, or `DBModelQuery.table` / `RecursiveDBModelQuery.table` — which is always the real
     * table or the recursive twin itself, never pre-aliased; `.of(Model, { as })` is what aliases
     * one. `meta` is looked up from the registry when left out, by matching the table against every
     * model's real and recursive table.
     *
     * @throws {Error} When no registered model owns the table and `meta` is not supplied
     *
     * @example
     * ```ts
     * Category.recursiveQuery()
     *     .anchor(Category.query().where({ parentId: null }))
     *     .step(Category.query())
     *     .on((cte, step) => eq(cte.id, TableRef.wrap(step).column('parentId')))
     * ```
     */
    static wrap<M = unknown>(table: TDrizzleTable, meta?: TTableMeta): TableRef<M> {
        const resolvedMeta = meta ?? ModelRegistry.all().find(m => m.drizzleTable === table || m.recursiveTable === table)
        if (!resolvedMeta) {
            throw new Error(`TableRef.wrap: no model is registered for table "${getTableName(table)}".`)
        }
        return new TableRef<M>(resolvedMeta, table, getTableName(table))
    }

    /** The underlying Drizzle table — real, twin, or aliased. */
    get table(): TDrizzleTable {
        return this.drizzleTable
    }

    /**
     * The `FROM`/`JOIN` element for this table, correctly spelled out as `"orig" "alias"` when
     * aliased. A bare `Table` chunk interpolated into a `sql` template renders only its current
     * name — the alias, once one is set — never the `"orig" "alias"` pair a `FROM` needs, so an
     * aliased reference needs this instead of being dropped into a template directly. Unaliased,
     * this is exactly the table itself.
     *
     * @example
     * ```ts
     * const ref = Author.ref({ as: 'a2' })
     * sql`select 1 from ${ref.from} where ${ref.column('name')} = 'x'`
     * // select 1 from "authors" "a2" where "a2"."name" = 'x'
     * ```
     */
    get from(): SQL {
        if (!this.alias) {
            return sql`${this.drizzleTable}`
        }
        return sql`${sql.identifier(this.physicalName)} ${sql.identifier(this.alias)}`
    }

    /**
     * The Drizzle column for a property key (the database column name is accepted too).
     *
     * @throws {Error} When the model has no such column, listing the ones it does have
     *
     * @example
     * ```ts
     * Author.ref().column('firstName')    // "authors"."first_name"
     * Author.ref().column('first_name')   // the same column, addressed by database name
     * ```
     */
    column(propertyKey: TColumnKey<M>): PgColumn {
        const key = String(propertyKey)
        const table = this.drizzleTable
        const column = table[key] ?? table[this.meta.columns.find(c => c.columnName === key)?.propertyKey ?? '']
        if (!column) {
            const known = this.meta.columns.map(c => `'${c.propertyKey}'`).join(', ')
            throw new Error(`Unknown column "${key}" on ${this.meta.tableName}. Known columns: ${known}.`)
        }
        return column
    }

    /**
     * A name that belongs to no column of any table — a `select({ extras })` computed on a
     * recursive query's anchor/step, carried down the recursion (a depth counter, a path). The
     * name itself is still invented by the caller; this only supplies the qualifier from metadata
     * instead of a hand-typed identifier.
     *
     * @example
     * ```ts
     * Category.ref({ recursive: true }).extra('depth')   // "categories__recursive"."depth"
     * ```
     */
    extra(name: string): SQL {
        return sql`${sql.identifier(this.alias ?? this.physicalName)}.${sql.identifier(name)}`
    }

    /**
     * `exists (select 1 from <path> where <link> [and <where>])`, correlated back to this `TableRef`.
     *
     * @throws {Error} When the path is empty, names an unknown relation, or crosses a `belongsToMany`
     *
     * @example
     * ```ts
     * Author.ref().existsRelation({ relation: 'books', where: { status: 'published' } })
     * // exists (select 1 from "books" where ("books"."author_id" = "authors"."id" and "books"."status" = $1))
     * ```
     */
    existsRelation(opts: TCorrelatedOptions): SQL {
        const path = this.buildPath(TableRef.stepsOf(opts))
        const query = this.finishQuery({ e: sql`1` }, path, opts, { skipOrderAndLimit: true })
        return exists(query)
    }

    /**
     * The negation of {@link existsRelation}.
     *
     * @example
     * ```ts
     * Author.query().where(Author.ref().notExistsRelation({ relation: 'books' }))
     * // ... where not exists (select 1 from "books" where "books"."author_id" = "authors"."id")
     * ```
     */
    notExistsRelation(opts: TCorrelatedOptions): SQL {
        return SqlConditions.not(this.existsRelation(opts))
    }

    /**
     * `(select <column> from <path> where <link> [and <where>] [order by] limit 1)`.
     *
     * @example
     * ```ts
     * Author.ref().valueOfRelation<string>({ relation: 'books', column: 'title', orderBy: [['rating', 'DESC']] })
     * // (select "title" from "books" where "books"."author_id" = "authors"."id"
     * //  order by "books"."rating" desc limit $1)
     * ```
     */
    valueOfRelation<T = unknown>(opts: TCorrelatedOptions & { column: string }): SQL<T> {
        const path = this.buildPath(TableRef.stepsOf(opts))
        const query = this.finishQuery({ v: path.scope.ref.column(opts.column) }, path, opts, { forceLimit: 1 })
        return sql`${query}` as SQL<T>
    }

    /**
     * `(select <fn>(<column>) from <path> where <link> [and <where>])`, optionally cast.
     *
     * `count` is the only function that runs without a `column`, as `count(*)`.
     *
     * @throws {Error} When `sum`, `min`, `max` or `avg` is asked for without a `column`
     *
     * @example
     * ```ts
     * Book.ref().aggregateOfRelation({ relation: 'reviews', fn: 'count', cast: 'integer' })
     * // (select count(*) from "reviews" where "reviews"."book_id" = "books"."id")::integer
     * ```
     */
    aggregateOfRelation<T = number>(opts: TCorrelatedOptions & {
        fn: 'count' | 'sum' | 'min' | 'max' | 'avg'
        column?: string
        cast?: string
    }): SQL<T> {
        const path = this.buildPath(TableRef.stepsOf(opts))
        const column = opts.column ? path.scope.ref.column(opts.column) : undefined
        const expr = TableRef.aggregateFn(opts.fn)(column)
        const query = this.finishQuery({ v: expr }, path, opts)
        const built = sql`${query}`
        return (opts.cast ? sql`${built}::${sql.raw(opts.cast)}` : built) as SQL<T>
    }

    /**
     * `(select <fn>(<column>) from <this table> where <where>)` — the uncorrelated sibling of
     * {@link aggregateOfRelation}, for rows picked out of this same table rather than reached
     * through a relation. On a recursive query's ref the table is the CTE twin, not the physical one.
     *
     * @throws {Error} When `sum`, `min`, `max` or `avg` is asked for without a `column`
     *
     * @example
     * ```ts
     * Book.ref().aggregate({ fn: 'avg', column: 'rating', where: { status: 'published' } })
     * // (select avg("rating") from "books" where "books"."status" = $1)
     * ```
     */
    aggregate<T = number>(opts: {
        fn: 'count' | 'sum' | 'min' | 'max' | 'avg'
        column?: string
        where?: TWhereInput
        cast?: string
    }): SQL<T> {
        const column = opts.column ? this.column(opts.column as TColumnKey<M>) : undefined
        const expr = TableRef.aggregateFn(opts.fn)(column)
        const conditions = [
            ...ConditionBuilder.fromWhere(this.drizzleTable, opts.where),
            TableRef.softDeleteCondition(this.meta, this.drizzleTable),
        ].filter((condition): condition is SQL => !!condition)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = Orm.conn().select({ v: expr }).from(this.drizzleTable)
        if (conditions.length) {
            query = query.where(and(...conditions))
        }
        const built = sql`${query}`
        return (opts.cast ? sql`${built}::${sql.raw(opts.cast)}` : built) as SQL<T>
    }

    /**
     * The general form: the library resolves the path and the correlation, the caller supplies
     * only the selected expression — `(select <select(scope)> from <path> where <link> [and <where>] [order by] [limit])`.
     *
     * @example
     * ```ts
     * Author.ref().selectFromRelation<string>({
     *     relation: 'books',
     *     where: { status: 'published' },
     *     select: scope => sql`upper(${scope.ref.column('title')})`,
     * })
     * // (select upper("title") from "books" where ("books"."author_id" = "authors"."id" and "books"."status" = $1))
     * ```
     */
    selectFromRelation<T = unknown>(opts: TCorrelatedOptions & { select: (scope: TRelationScope) => SQL }): SQL<T> {
        const path = this.buildPath(TableRef.stepsOf(opts))
        const query = this.finishQuery({ v: opts.select(path.scope) }, path, opts)
        return sql`${query}` as SQL<T>
    }

    private static stepsOf(opts: TCorrelatedOptions): TRelationStep[] {
        return Array.isArray(opts.relation) ? opts.relation : [opts.relation]
    }

    private static aggregateFn(fn: 'count' | 'sum' | 'min' | 'max' | 'avg'): (column?: PgColumn) => SQL {
        if (fn === 'count') {
            // the only one of the five that is meaningful without a column: count(*)
            return column => count(column) as SQL
        }
        const byColumn = { sum, min, max, avg }[fn]
        return (column?: PgColumn) => {
            if (!column) {
                throw new Error(`aggregateOfRelation: { fn: '${fn}' } needs a { column }.`)
            }
            return byColumn(column) as SQL
        }
    }

    private buildPath(steps: TRelationStep[]): { hops: TableRef[]; links: SQL[]; hopWhere: SQL[]; scope: TRelationScope } {
        if (!steps.length) {
            throw new Error(`${this.meta.tableName}: a relation path needs at least one step.`)
        }
        const counts = new Map<string, number>([[this.alias ?? this.physicalName, 1]])
        const hops: TableRef[] = []
        const links: SQL[] = []
        const hopWhere: SQL[] = []
        let prevMeta = this.meta
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let prevTable: any = this.drizzleTable

        for (const rawStep of steps) {
            const step = typeof rawStep === 'string' ? { as: rawStep } : rawStep
            const rel = step.as
                ? prevMeta.relations.find(r => r.propertyKey === step.as)
                : prevMeta.relations.find(r => r.target() === step.model)
            if (!rel) {
                const target = step.as ?? (step.model as { name?: string } | undefined)?.name
                throw new Error(`No relation from ${prevMeta.tableName} to ${target}`)
            }
            if (rel.kind === 'belongsToMany') {
                throw new Error(
                    `existsRelation cannot use the belongsToMany relation "${rel.propertyKey}" on `
                    + `${prevMeta.tableName}: the link runs through a junction table, not a single foreign key. `
                    + `Address the junction relation instead.`,
                )
            }
            const childMeta = ModelRegistry.require(step.model ?? rel.target() as new () => unknown)
            const alias = this.nextAlias(counts, childMeta.tableName)
            const hopRef = TableRef.of(childMeta.modelCtor as new () => unknown, { as: alias })
            const link = RelationForeignKey.linkCondition(prevTable, prevMeta, hopRef.table, childMeta, rel)
            if (!link) {
                throw new Error(
                    `No foreign key found for relation "${rel.propertyKey}" between ${prevMeta.tableName} `
                    + `and ${childMeta.tableName} — the path cannot be correlated.`,
                )
            }
            // built against the real table, then rewritten under the alias — the caller wrote the
            // condition before the alias was decided, exactly as a plain include's `where` does
            const raw = ConditionBuilder.fromWhere(childMeta.drizzleTable, step.where)
            hopWhere.push(...(alias ? raw.map(c => mapColumnsInSQLToAlias(c, alias)) : raw))
            const soft = TableRef.softDeleteCondition(childMeta, hopRef.table)
            if (soft) {
                hopWhere.push(soft)
            }
            hops.push(hopRef)
            links.push(link)
            prevMeta = childMeta
            prevTable = hopRef.table
        }

        const scope: TRelationScope = {
            ref: hops[hops.length - 1],
            column: (propertyKey: string) => hops[hops.length - 1].column(propertyKey),
            hop: (index: number) => hops[index],
            outer: this,
        }
        return { hops, links, hopWhere, scope }
    }

    private nextAlias(counts: Map<string, number>, tableName: string): string | undefined {
        const n = (counts.get(tableName) ?? 0) + 1
        counts.set(tableName, n)
        if (n === 1) {
            return undefined
        }
        return n === 2 ? `${tableName}${TableRef.ExistsAliasSuffix}` : `${tableName}${TableRef.ExistsAliasSuffix}${n - 1}`
    }

    private resolveWhere(where: TCorrelatedOptions['where'], scope: TRelationScope): SQL[] {
        if (!where) {
            return []
        }
        if (typeof where === 'function') {
            return [where(scope)]
        }
        return ConditionBuilder.fromWhere(scope.ref.table, where)
    }

    private normalizeOrderBy(item: OrderItemColumn | TOrderItemPair[], scope: TRelationScope): SQL[] {
        const pairs: TOrderItemPair[] = Array.isArray(item) ? item : [[item]]
        return pairs.map(([col, dir]) => {
            const column = col instanceof SQL ? col : scope.ref.column(col)
            return (String(dir).toUpperCase() === 'DESC' ? desc(column) : asc(column)) as SQL
        })
    }

    private finishQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        selection: Record<string, any>,
        path: { hops: TableRef[]; links: SQL[]; hopWhere: SQL[]; scope: TRelationScope },
        opts: TCorrelatedOptions,
        control?: { forceLimit?: number; skipOrderAndLimit?: boolean },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
        const { hops, links, hopWhere, scope } = path
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = Orm.conn().select(selection).from(hops[0].table)
        for (let i = 1; i < hops.length; i++) {
            query = query.innerJoin(hops[i].table, links[i])
        }
        const extra = this.resolveWhere(opts.where, scope)
        query = query.where(and(links[0], ...hopWhere, ...extra))
        if (!control?.skipOrderAndLimit) {
            if (opts.orderBy != null) {
                query = query.orderBy(...this.normalizeOrderBy(opts.orderBy, scope))
            }
            const limit = control?.forceLimit ?? opts.limit
            if (limit != null) {
                query = query.limit(limit)
            }
        }
        return query
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static softDeleteCondition(meta: TTableMeta, table: any): SQL | undefined {
        return meta.paranoid && meta.deletedAtKey ? isNull(table[meta.deletedAtKey]) : undefined
    }
}
