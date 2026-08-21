import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Chainable stub for the drizzle `db` object so BaseModel/DBModelQuery can be
 * exercised without a real Postgres connection. Records the arguments passed to
 * each terminal call and lets tests control returned rows.
 */
export type TMockDb = {
    db: any
    /** captured config of the last query[table].findMany / findFirst, and of the last flat select */
    captured: {
        cfg?: any
        selection?: any
        from?: any
        selectWhere?: any
        groupBy?: any[]
        having?: any
        selectOrderBy?: any[]
        limit?: number
        offset?: number
        statement?: any
    }
    calls: {
        update: jest.Mock
        insert: jest.Mock
        delete: jest.Mock
        set: jest.Mock
        values: jest.Mock
        onConflictDoUpdate: jest.Mock
        updateWhere: jest.Mock
        deleteWhere: jest.Mock
        findMany: jest.Mock
        findFirst: jest.Mock
        count: jest.Mock
        select: jest.Mock
        execute: jest.Mock
    }
    /** rows returned by insert/update .returning() */
    returningRows: unknown[]
    /** rows returned by query.findMany */
    findManyRows: unknown[]
    /** row returned by query.findFirst */
    findFirstRow: unknown
    /** count returned by $count */
    countValue: number
    /** rows returned by awaiting a flat select chain */
    selectRows: unknown[]
    /** rows returned by db.execute() */
    executeRows: unknown[]
}

export function createMockDb(tableNames: string[]): TMockDb {
    const state: TMockDb = {
        db: null,
        captured: {},
        returningRows: [{}],
        findManyRows: [],
        findFirstRow: null,
        countValue: 0,
        selectRows: [],
        executeRows: [],
        calls: {
            update: jest.fn(),
            insert: jest.fn(),
            delete: jest.fn(),
            set: jest.fn(),
            values: jest.fn(),
            onConflictDoUpdate: jest.fn(),
            updateWhere: jest.fn(),
            deleteWhere: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            select: jest.fn(),
            execute: jest.fn(),
        },
    }

    const query: Record<string, unknown> = {}
    for (const name of tableNames) {
        query[name] = {
            findMany: async (cfg: any) => {
                state.calls.findMany(cfg)
                state.captured.cfg = cfg
                return state.findManyRows
            },
            findFirst: async (cfg: any) => {
                state.calls.findFirst(cfg)
                state.captured.cfg = cfg
                return state.findFirstRow
            },
        }
    }

    state.db = {
        query,
        $count: async (table: unknown, where: unknown) => {
            state.calls.count({ table, where })
            return state.countValue
        },
        update: (table: unknown) => {
            state.calls.update(table)
            return {
                set: (v: unknown) => {
                    state.calls.set(v)
                    return {
                        where: (w: unknown) => {
                            state.calls.updateWhere(w)
                            return { returning: async () => state.returningRows }
                        },
                    }
                },
            }
        },
        insert: (table: unknown) => {
            state.calls.insert(table)
            return {
                values: (v: unknown) => {
                    state.calls.values(v)
                    return {
                        returning: async () => state.returningRows,
                        onConflictDoUpdate: (cfg: unknown) => {
                            state.calls.onConflictDoUpdate(cfg)
                            return { returning: async () => state.returningRows }
                        },
                    }
                },
            }
        },
        delete: (table: unknown) => {
            state.calls.delete(table)
            return { where: async (w: unknown) => state.calls.deleteWhere(w) }
        },
        // Flat select chain: builds EXISTS sub-queries (required-include) when it is not awaited,
        // and resolves to `selectRows` when it is (aggregates, grouped selects).
        select: (selection: unknown) => {
            state.calls.select(selection)
            state.captured.selection = selection
            const chain: Record<string, unknown> = { __subquery: true }
            const step = (key: keyof TMockDb['captured'], variadic = false) =>
                (...args: unknown[]) => {
                    state.captured[key] = (variadic ? args : args[0]) as never
                    return chain
                }
            Object.assign(chain, {
                from: step('from'),
                where: step('selectWhere'),
                groupBy: step('groupBy', true),
                having: step('having'),
                orderBy: step('selectOrderBy', true),
                limit: step('limit'),
                offset: step('offset'),
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                    Promise.resolve(state.selectRows).then(resolve, reject),
            })
            return chain
        },
        execute: async (statement: unknown) => {
            state.calls.execute(statement)
            state.captured.statement = statement
            return { rows: state.executeRows }
        },
        dialect: new PgDialect(),
    }

    return state
}
