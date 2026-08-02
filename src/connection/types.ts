import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

export type TOrmDatabase = NodePgDatabase<Record<string, unknown>>

export type Tx = Parameters<Parameters<TOrmDatabase['transaction']>[0]>[0]

export type TModelNotFoundErrorFactory = (model: Function) => Error

export type TOrmInitOptions = {
    pool?: Pool
    db?: TOrmDatabase
    modelNotFoundErrorFactory?: TModelNotFoundErrorFactory
}
