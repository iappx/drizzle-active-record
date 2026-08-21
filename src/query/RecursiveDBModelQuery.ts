import { mapRelationalRow, SQL, sql } from 'drizzle-orm'
import { Orm } from '../connection/Orm'
import { Hydrator } from '../model/Hydrator'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { DBModelQuery } from './DBModelQuery'
import { QueryExecutor } from './QueryExecutor'

// A reference to the rows already collected by the recursion. Any name is addressable, so
// values the anchor invents through select extras — a depth counter, a path — can be read back.
export type TCteRef = Record<string, SQL>

// The recursive term's own table: real columns of the model.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TStepRef = Record<string, any>

export type TRecursiveJoin = SQL | ((cte: TCteRef, step: TStepRef) => SQL)

/**
 * A `WITH RECURSIVE` query — Postgres' way of walking a self-referencing table.
 *
 *     Category.recursiveQuery()
 *         .anchor(Category.query().where({ parentId: null }))
 *         .step(Category.query())
 *         .on((cte, step) => eq(cte.id, step.parentId))
 *         .includeModel(Account).endInclude()
 *         .getAll()
 *
 * Drizzle has no builder for `WITH RECURSIVE` (`db.$with` emits a plain, non-recursive `WITH`),
 * so the CTE itself is rendered here. Everything after it is not: each model owns a twin table
 * named after the CTE, and the CTE shadows it, so the query over the recursion result is an
 * ordinary relational query — **relations, nested includes and all, in a single statement**.
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
 * To carry a value down the recursion, declare it in both terms and read it off `cte`:
 *
 *     .anchor(Category.query().select({ extras: { depth: sql`1`.as('depth') } }))
 *     .step(Category.query().select({ extras: { depth: sql`"categories__recursive"."depth" + 1`.as('depth') } }))
 *     .on((cte, step) => and(eq(cte.id, step.parentId), lt(cte.depth, 5)) as SQL)
 */
export class RecursiveDBModelQuery<M> extends DBModelQuery<M> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private anchorQuery?: DBModelQuery<any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private stepQuery?: DBModelQuery<any>
    private joinCondition?: TRecursiveJoin
    private unionAll = true

    /**
     * Conditions and ordering are built against the twin, which is what the outer query selects
     * from. The terms of the CTE keep using the real table.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected get table(): any {
        if (!this.meta.recursiveTable) {
            SchemaBuilder.build()
        }
        return this.meta.recursiveTable
    }

    /** The non-recursive term: the rows the walk starts from. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public anchor(query: DBModelQuery<any>): this {
        this.anchorQuery = query
        return this
    }

    /** The recursive term: applied to the rows produced so far until it yields nothing. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public step(query: DBModelQuery<any>): this {
        this.stepQuery = query
        return this
    }

    /** How the recursive term joins the rows collected so far. Also where a depth bound goes. */
    public on(condition: TRecursiveJoin): this {
        this.joinCondition = condition
        return this
    }

    /** Deduplicate rows between iterations (`union` instead of the default `union all`). */
    public distinct(): this {
        this.unionAll = false
        return this
    }

    public get cteName(): string {
        return SchemaBuilder.recursiveTableName(this.meta)
    }

    public async getAll(): Promise<M[]> {
        const rows = await this.runRecursive()
        return Hydrator.hydrateMany(this.modelCtor, rows)
    }

    public async getOne(): Promise<M | null> {
        const rows = await this.limit(1).runRecursive()
        return Hydrator.hydrate(this.modelCtor, rows[0])
    }

    public async getByPK(identifier: unknown): Promise<M | null> {
        this.where({ [this.meta.primaryKey]: identifier })
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

    public toSQL(): { sql: string; params: unknown[] } {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = Orm.conn(this.tx, this.replica) as any
        const built = conn.dialect.sqlToQuery(this.buildStatement(conn).statement)
        return { sql: built.sql, params: built.params }
    }

    /** The whole statement: the CTE, then the relational query that reads it. */
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
        const stepSql = stepQuery.renderSelectSql() as SQL

        const condition = typeof this.joinCondition === 'function'
            ? this.joinCondition(this.cteRef(), stepQuery.table)
            : this.joinCondition
        const union = this.unionAll ? sql`union all` : sql`union`

        return sql`with recursive ${this.cteId()} as (${anchorSql} ${union} ${stepSql} inner join ${this.cteId()} on ${condition})`
    }

    /**
     * Runs the statement through drizzle's own session and row mapper, so a recursive query
     * returns exactly the shape an ordinary relational query does — nested relations included.
     */
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
