import { SQL } from 'drizzle-orm'
import { TColumns } from './types'

export class QueryNode {
    public columns?: TColumns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public extras?: Record<string, any>
    public where: SQL[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public orderBy: (SQL | any)[] = []
    public limit?: number
    public offset?: number
    public with: Record<string, QueryNode> = {}
}
