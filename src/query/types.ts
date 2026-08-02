import { SQL } from 'drizzle-orm'

export type MAttributes<M> = Partial<M>
export type MCreationAttributes<M> = Record<string, unknown>
export type OrderItemColumn = string | SQL

export type TWhere = Record<string, unknown> | SQL
export type TColumns = Record<string, true>

export type TIncludeOptions = {
    required?: boolean
}

export type TRawInclude = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model?: new () => any
    as?: string
    where?: Record<string, unknown>
    required?: boolean
    include?: TRawInclude[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TRawIncludeInput = TRawInclude | (new () => any)
