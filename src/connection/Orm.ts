import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { ModelNotFoundError } from '../errors/ModelNotFoundError'
import { TModelNotFoundErrorFactory, TOrmDatabase, TOrmInitOptions, Tx } from './types'

export class Orm {
    private static database?: TOrmDatabase
    private static readDatabase?: TOrmDatabase
    private static ownedPool?: Pool
    private static ownedReadPool?: Pool
    private static notFoundErrorFactory?: TModelNotFoundErrorFactory

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

    public static get db(): TOrmDatabase {
        if (!this.database) {
            throw new Error('Orm is not initialized: call Orm.init({ pool }) before running queries')
        }
        return this.database
    }

    // falls back to the write connection when no replica was configured
    public static get readDb(): TOrmDatabase {
        return this.readDatabase ?? this.db
    }

    public static get hasReplica(): boolean {
        return this.readDatabase != null
    }

    public static get isInitialized(): boolean {
        return this.database != null
    }

    // return type is `any`: a db|tx union breaks `.returning()` inference on drizzle chains
    // a transaction always stays on the connection it was opened on
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static conn(tx?: Tx, useReplica = false): any {
        if (tx) {
            return tx
        }
        return useReplica ? this.readDb : this.db
    }

    public static createModelNotFoundError(model: Function): Error {
        return this.notFoundErrorFactory ? this.notFoundErrorFactory(model) : new ModelNotFoundError(model)
    }

    public static async close(): Promise<void> {
        await this.ownedPool?.end()
        await this.ownedReadPool?.end()
        this.ownedPool = undefined
        this.ownedReadPool = undefined
        this.database = undefined
        this.readDatabase = undefined
    }
}
