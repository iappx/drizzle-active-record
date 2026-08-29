import { mapRelationalRow, SQL, sql } from 'drizzle-orm'
import { Orm } from '../connection/Orm'
import { Hydrator } from '../model/Hydrator'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { DBModelQuery } from './DBModelQuery'
import { QueryExecutor } from './QueryExecutor'
import { TableRef } from './TableRef'

/**
 * A reference to the rows already collected by the recursion. Any name is addressable, so values
 * the anchor invents through select extras — a depth counter, a path — can be read back.
 */
export type TCteRef = Record<string, SQL>

/** The recursive term's own table: real columns of the model. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TStepRef = Record<string, any>

/**
 * The join between the recursive term and the rows collected so far — a raw `SQL` fragment, or a
 * callback given the CTE reference, the step term's raw table, and `stepRef`, that same table
 * wrapped as a `TableRef` carrying the model's metadata.
 */
export type TRecursiveJoin = SQL | ((cte: TCteRef, step: TStepRef, stepRef: TableRef) => SQL)

/**
 * A `WITH RECURSIVE` query — Postgres' way of walking a self-referencing table.
 *
 * The recursion result is read back as an ordinary relational query, so relations and nested
 * includes come with it in a single statement:
 *
 *     with recursive "categories__recursive" as (
 *         <anchor> union all <step> inner join "categories__recursive" on ...
 *     )
 *     select ... from "categories__recursive" ... left join lateral (...) ...
 *
 * In Postgres' terms `anchor` is the non-recursive term and `step` the recursive one.
 *
 * `where`, `orderBy`, `limit` and includes set on this query apply to **the result of the
 * recursion**, not to the source table.
 *
 * @example
 * ```ts
 * const branch = await Category.recursiveQuery()
 *     .anchor(Category.query().where({ parentId: null }))
 *     .step(Category.query())
 *     .on((cte, step) => eq(cte.id, step.parentId))
 *     .includeModel(Article)
 *     .endInclude()
 *     .getAll()
 * ```
 *
 * @example
 * A value carried down the recursion is declared in both terms and read off `cte`:
 * ```ts
 * await Category.recursiveQuery()
 *     .anchor(Category.query().select({ extras: { depth: sql`1`.as('depth') } }))
 *     .step(Category.query().select({
 *         extras: { depth: sql`"categories__recursive"."depth" + 1`.as('depth') },
 *     }))
 *     .on((cte, step) => and(eq(cte.id, step.parentId), lt(cte.depth, 5)) as SQL)
 *     .getAll()
 * ```
 */
export class RecursiveDBModelQuery<M> extends DBModelQuery<M> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private anchorQuery?: DBModelQuery<any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private stepQuery?: DBModelQuery<any>
    private joinCondition?: TRecursiveJoin
    private unionAll = true

    // the outer query selects from the twin, so conditions and ordering must be built against it,
    // while the terms of the CTE keep using the real table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected get table(): any {
        if (!this.meta.recursiveTable) {
            SchemaBuilder.build()
        }
        return this.meta.recursiveTable
    }

    /**
     * The non-recursive term: the rows the walk starts from.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * Category.recursiveQuery().anchor(Category.query().where({ parentId: null }))
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public anchor(query: DBModelQuery<any>): this {
        this.anchorQuery = query
        return this
    }

    /**
     * The recursive term: applied to the rows produced so far until it yields nothing.
     *
     * The term's own `where`, `orderBy` and `limit` narrow that iteration; the join back to the
     * collected rows is placed right after `FROM`, ahead of them.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * Category.recursiveQuery()
     *     .anchor(Category.query().where({ parentId: null }))
     *     .step(Category.query().where({ title: 'active' }))
     * ```
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public step(query: DBModelQuery<any>): this {
        this.stepQuery = query
        return this
    }

    /**
     * How the recursive term joins the rows collected so far. Also where a depth bound goes.
     *
     * A raw `SQL` fragment is accepted in place of the callback, and `stepRef` reaches the step
     * term's columns by property key rather than through the raw table.
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * Category.recursiveQuery()
     *     .anchor(Category.query().where({ parentId: null }))
     *     .step(Category.query())
     *     .on((cte, step, stepRef) => eq(cte.id, stepRef.column('parentId')))
     * ```
     */
    public on(condition: TRecursiveJoin): this {
        this.joinCondition = condition
        return this
    }

    /**
     * Deduplicate rows between iterations (`union` instead of the default `union all`).
     *
     * @returns The same query, for chaining
     *
     * @example
     * ```ts
     * const graph = await Category.recursiveQuery()
     *     .anchor(Category.query().where({ parentId: null }))
     *     .step(Category.query())
     *     .on((cte, step) => eq(cte.id, step.parentId))
     *     .distinct()
     *     .getAll()
     * ```
     */
    public distinct(): this {
        this.unionAll = false
        return this
    }

    /** The name of the CTE this query defines and reads from — `<table>__recursive`. */
    public get cteName(): string {
        return SchemaBuilder.recursiveTableName(this.meta)
    }

    // branches alias from the CTE the outer query reads, not from the real table
    protected get rootAlias(): string {
        return this.cteName
    }

    /**
     * Runs the statement and hydrates every row of the recursion result into the model.
     *
     * @returns An empty array when the recursion produces nothing
     *
     * @example
     * ```ts
     * const branch = await Category.recursiveQuery()
     *     .anchor(Category.query().where({ parentId: null }))
     *     .step(Category.query())
     *     .on((cte, step) => eq(cte.id, step.parentId))
     *     .orderBy('title')
     *     .getAll()
     * ```
     */
    public async getAll(): Promise<M[]> {
        const rows = await this.runRecursive()
        return Hydrator.hydrateMany(this.modelCtor, rows)
    }

    /**
     * The first row of the recursion result, with `limit 1` applied to the outer query.
     *
     * @returns `null` when the recursion produces nothing
     */
    public async getOne(): Promise<M | null> {
        const rows = await this.limit(1).runRecursive()
        return Hydrator.hydrate(this.modelCtor, rows[0])
    }

    /**
     * The row of the recursion result whose primary key matches, narrowing the outer query.
     *
     * @returns `null` when the recursion holds no such row
     */
    public async getByPK(identifier: unknown): Promise<M | null> {
        this.where({ [this.meta.primaryKey]: identifier })
        return this.getOne()
    }

    /**
     * {@link getOne}, but a missing row is an error rather than `null`.
     *
     * @throws {Error} `ModelNotFoundError` when the recursion produces nothing
     */
    public async tryGetOne(): Promise<M> {
        const res = await this.getOne()
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    /**
     * {@link getByPK}, but a missing row is an error rather than `null`.
     *
     * @throws {Error} `ModelNotFoundError` when the recursion holds no row under that key
     */
    public async tryFindByPk(identifier: unknown): Promise<M> {
        const res = await this.getByPK(identifier)
        if (!res) {
            throw Orm.createModelNotFoundError(this.modelCtor)
        }
        return res
    }

    /**
     * `count(*)` over the recursion result, narrowed by the outer `where`.
     *
     * Includes, ordering and limits set on the query take no part in it.
     *
     * @returns `0` when the recursion produces nothing
     */
    public async count(_distinct = true): Promise<number> {
        const where = this.whereCondition()
        const statement = sql`${this.buildCte()} select count(*) as "count" from ${sql.identifier(this.cteName)}${
            where ? sql` where ${where}` : sql``
        }`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = Orm.conn(this.tx, this.replica) as any
        const result = await QueryExecutor.run<unknown>(() => conn.execute(statement))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = ((result as any)?.rows ?? result) as Record<string, unknown>[]
        return Number(rows?.[0]?.count ?? 0)
    }

    /**
     * The whole statement as text and bind parameters — the CTE and the query that reads it —
     * without executing anything.
     *
     * @throws {Error} When `anchor`, `step` or `on` has not been set
     *
     * @example
     * ```ts
     * const { sql, params } = Category.recursiveQuery()
     *     .anchor(Category.query().where({ title: 'root' }))
     *     .step(Category.query())
     *     .on((cte, step) => eq(cte.id, step.parentId))
     *     .toSQL()
     * ```
     */
    public toSQL(): { sql: string; params: unknown[] } {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = Orm.conn(this.tx, this.replica) as any
        const built = conn.dialect.sqlToQuery(this.buildStatement(conn).statement)
        return { sql: built.sql, params: built.params }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private buildStatement(conn: any): { statement: SQL; query: any } {
        const query = conn.query[this.cteName].findMany(this.buildConfig(this.node, this.meta))
        const { sql: querySql } = query._getQuery()
        return { statement: sql`${this.buildCte()} ${querySql}`, query }
    }

    private cteId(): SQL {
        return sql`${sql.identifier(this.cteName)}`
    }

    // every name resolves to a column of the CTE, including ones no table has
    private cteRef(): TCteRef {
        const id = this.cteId()
        return new Proxy({} as TCteRef, {
            get: (_target, key: string): SQL => sql`${id}.${sql.identifier(key)}`,
        })
    }

    private buildCte(): SQL {
        if (!this.anchorQuery || !this.stepQuery) {
            throw new Error('A recursive query needs both .anchor(query) and .step(query)')
        }
        if (!this.joinCondition) {
            throw new Error('A recursive query needs .on(...) to join the recursive term to the collected rows')
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anchorSql = (this.anchorQuery as any).renderSelectSql() as SQL
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepQuery = this.stepQuery as any

        const condition = typeof this.joinCondition === 'function'
            ? this.joinCondition(this.cteRef(), stepQuery.table, TableRef.wrap(stepQuery.table, this.meta))
            : this.joinCondition
        // has to sit right after FROM — passed into renderSelectSql rather than appended to its
        // result, or it would land after the step term's own WHERE/GROUP BY/... clauses
        const join = sql`inner join ${this.cteId()} on ${condition}`
        const stepSql = stepQuery.renderSelectSql(undefined, join) as SQL

        const union = this.unionAll ? sql`union all` : sql`union`

        return sql`with recursive ${this.cteId()} as (${anchorSql} ${union} ${stepSql})`
    }

    private async runRecursive(): Promise<Record<string, unknown>[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = Orm.conn(this.tx, this.replica) as any
        const { statement, query } = this.buildStatement(conn)
        const { selection } = query._getQuery()
        const builtQuery = conn.dialect.sqlToQuery(statement)

        const prepared = query.session.prepareQuery(
            builtQuery,
            undefined,
            undefined,
            // the relational row mapper reads positional arrays
            true,
            (rawRows: unknown[][], mapColumnValue: (value: unknown) => unknown) => rawRows.map(row =>
                mapRelationalRow(query.schema, query.tableConfig, row, selection, mapColumnValue),
            ),
        )
        const rows = await QueryExecutor.run<Record<string, unknown>[]>(() => prepared.execute())
        return rows ?? []
    }
}
