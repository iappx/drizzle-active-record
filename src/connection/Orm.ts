import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { ModelNotFoundError } from '../errors/ModelNotFoundError'
import { TModelNotFoundErrorFactory, TOrmDatabase, TOrmInitOptions, Tx } from './types'

/**
 * Holds the process-wide database connections and hands them to every query.
 *
 * Every member is static: one `init` call at boot serves the whole application.
 */
export class Orm {
    private static database?: TOrmDatabase
    private static readDatabase?: TOrmDatabase
    private static ownedPool?: Pool
    private static ownedReadPool?: Pool
    private static notFoundErrorFactory?: TModelNotFoundErrorFactory

    /**
     * Connects the ORM and returns the primary database instance.
     *
     * Given a `pool`, builds the Drizzle schema from the model registry and creates the instance; given a
     * `db`, adopts it as is. A replica is configured the same way through `readPool` or `readDb`, and
     * nothing is routed to it until a query calls `.useReplica()`. Only pools created here are ended by
     * `close()`.
     *
     * @returns The primary database instance, the same one `Orm.db` returns
     * @throws {Error} When neither `pool` nor `db` is supplied
     *
     * @example
     * ```ts
     * SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
     *
     * Orm.init({
     *     pool: new Pool({ host, port, user, password, database }),
     *     readPool: new Pool({ host: replicaHost, port, user, password, database }),
     * })
     *
     * const users = await User.query().where({ active: true }).useReplica().getAll()
     * ```
     */
    public static init(options: TOrmInitOptions): TOrmDatabase {
        if (options.modelNotFoundErrorFactory) {
            this.notFoundErrorFactory = options.modelNotFoundErrorFactory
        }
        if (options.db) {
            this.database = options.db
        } else if (options.pool) {
            this.ownedPool = options.pool
            this.database = drizzle(options.pool, { schema: SchemaBuilder.build() })
        } else {
            throw new Error('Orm.init requires either a "pool" or an already built "db"')
        }
        if (options.readDb) {
            this.readDatabase = options.readDb
        } else if (options.readPool) {
            this.ownedReadPool = options.readPool
            this.readDatabase = drizzle(options.readPool, { schema: SchemaBuilder.getSchema() })
        }
        return this.database
    }

    /**
     * The primary database instance, for raw queries and `db.transaction(...)`.
     *
     * @throws {Error} When `init` has not run
     *
     * @example
     * ```ts
     * await Orm.db.transaction(async transaction => {
     *     await Author.create({ name: 'Ann' }, { transaction })
     * })
     * ```
     */
    public static get db(): TOrmDatabase {
        if (!this.database) {
            throw new Error('Orm is not initialized: call Orm.init({ pool }) before running queries')
        }
        return this.database
    }

    /** The replica instance, or the primary one when no replica was configured. */
    public static get readDb(): TOrmDatabase {
        return this.readDatabase ?? this.db
    }

    /** `true` when `init` was given a replica. */
    public static get hasReplica(): boolean {
        return this.readDatabase != null
    }

    /** `true` once `init` has run and before `close` resets it. */
    public static get isInitialized(): boolean {
        return this.database != null
    }

    /**
     * Returns the connection a statement runs on.
     *
     * A transaction wins over `useReplica`: it stays on the connection it was opened on. Without a
     * transaction, `useReplica` picks `readDb`, which is the primary when no replica is configured.
     *
     * @example
     * ```ts
     * const rows = await Orm.conn(transaction).select().from(authors)
     * ```
     */
    // return type is `any`: a db|tx union breaks `.returning()` inference on drizzle chains
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static conn(tx?: Tx, useReplica = false): any {
        if (tx) {
            return tx
        }
        return useReplica ? this.readDb : this.db
    }

    /**
     * Builds the error a failed lookup throws.
     *
     * Delegates to the `modelNotFoundErrorFactory` given to `init`, and falls back to
     * `ModelNotFoundError` when none was given.
     */
    public static createModelNotFoundError(model: Function): Error {
        return this.notFoundErrorFactory ? this.notFoundErrorFactory(model) : new ModelNotFoundError(model)
    }

    /**
     * Ends the pools the ORM created itself and forgets both connections.
     *
     * A `db` or `readDb` handed to `init` keeps its own pool open; after this call `isInitialized` is
     * `false` and `init` may run again.
     */
    public static async close(): Promise<void> {
        await this.ownedPool?.end()
        await this.ownedReadPool?.end()
        this.ownedPool = undefined
        this.ownedReadPool = undefined
        this.database = undefined
        this.readDatabase = undefined
    }
}
