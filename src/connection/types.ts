import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/** The Drizzle `node-postgres` instance the ORM runs every statement through. */
export type TOrmDatabase = NodePgDatabase<Record<string, unknown>>

/** The transaction handle Drizzle passes to the callback of `db.transaction(...)`. */
export type Tx = Parameters<Parameters<TOrmDatabase['transaction']>[0]>[0]

/**
 * Builds the error thrown when a lookup finds no row.
 *
 * @example
 * ```ts
 * const factory: TModelNotFoundErrorFactory = model => new MyNotFoundException(model.name)
 * ```
 */
export type TModelNotFoundErrorFactory = (model: Function) => Error

/**
 * Options accepted by `Orm.init`.
 *
 * Exactly one of `pool` or `db` describes the primary connection; the replica is optional.
 *
 * @example
 * ```ts
 * Orm.init({
 *     pool: new Pool({ host, port, user, password, database }),
 *     readPool: new Pool({ host: replicaHost, port, user, password, database }),
 *     modelNotFoundErrorFactory: model => new MyNotFoundException(model.name),
 * })
 * ```
 */
export type TOrmInitOptions = {
    /** Primary pool the ORM connects and owns: `close()` ends it. */
    pool?: Pool
    /** Ready-made primary instance, used instead of `pool`; the ORM does not own its pool. */
    db?: TOrmDatabase
    /** Read replica pool. Only queries that explicitly ask for it are routed here. */
    readPool?: Pool
    /** Ready-made replica instance, used instead of `readPool`; the ORM does not own its pool. */
    readDb?: TOrmDatabase
    /** Replaces `ModelNotFoundError` in `tryGetOne()` / `tryFindByPk()`. */
    modelNotFoundErrorFactory?: TModelNotFoundErrorFactory
}
