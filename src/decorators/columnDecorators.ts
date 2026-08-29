import { ModelRegistry } from '../registry/ModelRegistry'
import { TColumnOptions, TColumnRole, TDbDataType } from '../types/metadata'

/**
 * Maps the decorated property to a database column.
 *
 * Leaving `columnName` out hands the name to the configured naming strategy, which derives it from
 * the property key; a column with neither an explicit name nor a strategy fails `SchemaBuilder.build()`.
 *
 * @param dataType Column type, taken from `DataType`
 * @param columnName Database column name, written exactly as it exists
 * @param options Primary key, auto-increment, nullability and default value
 *
 * @example
 * ```ts
 * @Table('authors')
 * export class Author extends QueryableModel<Author, TAuthorCA> {
 *     @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
 *     id: number
 *
 *     @NamedColumn(DataType.STRING)
 *     firstName: string
 *
 *     @NamedColumn(DataType.STRING, 'slug', { allowNull: false })
 *     slug: string
 * }
 * ```
 */
export function NamedColumn(dataType: TDbDataType, columnName?: string, options: TColumnOptions = {}): PropertyDecorator {
    return (target, propertyKey) => {
        const key = String(propertyKey)
        ModelRegistry.defineColumn(target.constructor, {
            propertyKey: key,
            columnName,
            dataType,
            options,
        })
    }
}

function timestampRole(role: TColumnRole): PropertyDecorator {
    return (t, propertyKey) => {
        const key = String(propertyKey)
        const column = ModelRegistry.get(t.constructor)?.columns.find(c => c.propertyKey === key)
        if (column) {
            ModelRegistry.assignRole(t.constructor, key, role)
        } else {
            // fallback when @NamedColumn is not stacked below: register a DATE column
            ModelRegistry.defineColumn(t.constructor, {
                propertyKey: key,
                dataType: { kind: 'date' },
                options: {},
                role,
            })
        }
    }
}

/**
 * Marks the decorated property as the creation timestamp, filled with the current date on insert.
 *
 * Stacks above `@NamedColumn`, which gives the column its type and name. On its own it registers a
 * `DATE` column named by the naming strategy.
 *
 * @example
 * ```ts
 * @CreatedColumn()
 * @NamedColumn(DataType.DATE, 'created_at')
 * createdAt: Date
 * ```
 */
export function CreatedColumn(): PropertyDecorator {
    return timestampRole('createdAt')
}

/**
 * Marks the decorated property as the modification timestamp, filled with the current date on insert
 * and rewritten on every update.
 *
 * Stacks above `@NamedColumn`, which gives the column its type and name. On its own it registers a
 * `DATE` column named by the naming strategy.
 *
 * @example
 * ```ts
 * @UpdatedColumn()
 * @NamedColumn(DataType.DATE, 'updated_at')
 * updatedAt: Date
 * ```
 */
export function UpdatedColumn(): PropertyDecorator {
    return timestampRole('updatedAt')
}

/**
 * Marks the decorated property as the soft-delete timestamp.
 *
 * The column is stamped by `delete` and checked by every query only on a model declared
 * `@Table(name, { paranoid: true })`; without that option rows are deleted for real and the column is an
 * ordinary date. Stacks above `@NamedColumn`, which gives the column its type and name.
 *
 * @example
 * ```ts
 * @Table('soft_entities', { paranoid: true })
 * export class SoftEntity extends QueryableModel<SoftEntity, TSoftCA> {
 *     @DeletedColumn()
 *     @NamedColumn(DataType.DATE, 'deleted_at')
 *     deletedAt: Date
 * }
 * ```
 */
export function DeletedColumn(): PropertyDecorator {
    return timestampRole('deletedAt')
}

/**
 * Declares the decorated column a foreign key to `target`, so relations can find the column to join on.
 *
 * Stacks above `@NamedColumn`, which gives the column its type and name. Repeating the decorator adds
 * further targets to the same column rather than replacing the previous one. A relation whose model
 * has two columns pointing at the same target has to name one through `{ foreignKey }`.
 *
 * @param target Thunk returning the referenced model class
 *
 * @example
 * ```ts
 * @Table('books')
 * export class Book extends QueryableModel<Book, TBookCA> {
 *     @ForeignKey(() => Author)
 *     @NamedColumn(DataType.BIGINT, 'author_id')
 *     authorId: number
 *
 *     @BelongsTo(() => Author)
 *     author: Author
 * }
 * ```
 */
export function ForeignKey(target: () => Function): PropertyDecorator {
    return (t, propertyKey) => {
        const meta = ModelRegistry.get(t.constructor)
        const key = String(propertyKey)
        const column = meta?.columns.find(c => c.propertyKey === key)
        if (column) {
            // one column may be a foreign key to more than one model — an entity and a view over it
            column.foreignKeyTargets = [...(column.foreignKeyTargets ?? []), target]
        } else {
            // fallback when @NamedColumn is not stacked below
            ModelRegistry.defineColumn(t.constructor, {
                propertyKey: key,
                dataType: { kind: 'integer' },
                options: {},
                foreignKeyTargets: [target],
            })
        }
    }
}
