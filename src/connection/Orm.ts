import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { SchemaBuilder } from '../schema/SchemaBuilder'
import { ModelNotFoundError } from '../errors/ModelNotFoundError'
import { TModelNotFoundErrorFactory, TOrmDatabase, TOrmInitOptions, Tx } from './types'

export class Orm {
    private static database?: TOrmDatabase
    private static ownedPool?: Pool
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
        return this.database
    }

    public static get db(): TOrmDatabase {
        if (!this.database) {
            throw new Error('Orm is not initialized: call Orm.init({ pool }) before running queries')
        }
        return this.database
    }

    public static get isInitialized(): boolean {
        return this.database != null
    }

    // return type is `any`: a db|tx union breaks `.returning()` inference on drizzle chains
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static conn(tx?: Tx): any {
        return tx ?? this.db
    }

    public static createModelNotFoundError(model: Function): Error {
        return this.notFoundErrorFactory ? this.notFoundErrorFactory(model) : new ModelNotFoundError(model)
    }

    public static async close(): Promise<void> {
        await this.ownedPool?.end()
        this.ownedPool = undefined
        this.database = undefined
    }
}
