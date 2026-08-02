import { eq, inArray, isNull, SQL } from 'drizzle-orm'
import { Op } from '../filter/Op'

export class ConditionBuilder {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static fromValue(column: any, value: unknown): SQL {
        if (value instanceof Op) {
            return value.build(column)
        }
        if (Array.isArray(value)) {
            return inArray(column, value)
        }
        if (value === null) {
            return isNull(column)
        }
        return eq(column, value)
    }
}
