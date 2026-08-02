import { BaseModel } from './BaseModel'
import { DBModelQuery } from '../query/DBModelQuery'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class QueryableModel<M extends BaseModel = any, CA extends object = any> extends BaseModel<M, CA> {
}

export type QueryableModelCtor<M extends QueryableModel = QueryableModel> = (new () => M) & {
    query(): DBModelQuery<M>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(attrs: any, opts?: any): Promise<M>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkCreate(attrs: any[], opts?: any): Promise<M[]>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destroy(opts: { where: any; transaction?: any }): Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hydrate(row: any): M | null
    build(attrs: object): M
    primaryKeyAttribute: string
}
