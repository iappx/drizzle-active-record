import { ModelRegistry } from '../registry/ModelRegistry'
import { TTableOptions } from '../types/metadata'

export function Table(tableName: string, opts?: TTableOptions): ClassDecorator
export function Table(opts: { tableName: string } & TTableOptions & Record<string, unknown>): ClassDecorator
export function Table(
    tableNameOrOpts: string | ({ tableName: string } & Record<string, unknown>),
    opts: TTableOptions = {},
): ClassDecorator {
    return (target) => {
        if (typeof tableNameOrOpts === 'string') {
            ModelRegistry.defineTable(target, tableNameOrOpts, opts)
        } else {
            const { tableName, paranoid } = tableNameOrOpts as { tableName: string } & TTableOptions
            ModelRegistry.defineTable(target, tableName, { paranoid })
        }
    }
}
