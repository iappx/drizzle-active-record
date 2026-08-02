import { and, or, SQL } from 'drizzle-orm'

export class SqlConditions {
    public static allOf(conditions: SQL[]): SQL | undefined {
        return conditions.length ? (and(...conditions) as SQL) : undefined
    }

    public static anyOf(conditions: SQL[]): SQL | undefined {
        return conditions.length ? (or(...conditions) as SQL) : undefined
    }
}
