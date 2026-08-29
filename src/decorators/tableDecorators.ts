import { ModelRegistry } from '../registry/ModelRegistry'
import { TTableOptions } from '../types/metadata'

/**
 * Registers the decorated class as a model mapped to `tableName`.
 *
 * The table name is always taken literally — the naming strategy applies to columns only. With
 * `paranoid: true` the model soft-deletes: `delete` stamps the `@DeletedColumn()` column and every
 * query excludes the stamped rows.
 *
 * @param tableName Database table name, written exactly as it exists
 * @param opts `paranoid` turns the model into a soft-deleting one
 *
 * @example
 * ```ts
 * @Table('training_program', { paranoid: true })
 * export class TrainingProgram extends QueryableModel<TrainingProgram, TTrainingProgramCA> {
 *     @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
 *     id: number
 *
 *     @NamedColumn(DataType.STRING, 'title')
 *     title: string
 *
 *     @DeletedColumn()
 *     @NamedColumn(DataType.DATE, 'deleted_at')
 *     deletedAt: Date
 * }
 * ```
 */
export function Table(tableName: string, opts?: TTableOptions): ClassDecorator
/**
 * Registers the decorated class as a model, reading the table name from the options object.
 *
 * Keys other than `tableName` and `paranoid` are ignored.
 *
 * @param opts Carries `tableName`; `paranoid` turns the model into a soft-deleting one
 *
 * @example
 * ```ts
 * @Table({ tableName: 'soft_entities', paranoid: true })
 * export class SoftEntity extends QueryableModel<SoftEntity, TSoftCA> {
 *     @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
 *     id: number
 *
 *     @DeletedColumn()
 *     @NamedColumn(DataType.DATE, 'deleted_at')
 *     deletedAt: Date
 * }
 * ```
 */
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
