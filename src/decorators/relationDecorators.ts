import { ModelRegistry } from '../registry/ModelRegistry'
import { TRelationOptions } from '../types/metadata'

/**
 * Declares a many-to-one relation: the foreign key lives on the declaring model.
 *
 * `foreignKey` names the column on the declaring model, `targetKey` the column on the target the key
 * points at. Left out, the single `@ForeignKey(() => Target)` column is used and joined to the target's
 * primary key; two columns reaching the same target make `foreignKey` mandatory.
 *
 * @param target Thunk returning the related model class
 *
 * @example
 * ```ts
 * @Table('positions')
 * export class Position extends QueryableModel<Position, TPositionCA> {
 *     @NamedColumn(DataType.BIGINT, 'account_id')
 *     accountId: number
 *
 *     @ForeignKey(() => Position)
 *     @NamedColumn(DataType.BIGINT, 'parent_id')
 *     parentId: number
 *
 *     @BelongsTo(() => Position, { foreignKey: 'parentId' })
 *     parent: Position
 *
 *     @BelongsTo(() => Position, { foreignKey: 'accountId', targetKey: 'accountId' })
 *     genealogyPosition: Position
 * }
 * ```
 */
export function BelongsTo(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
            foreignKey: opts?.foreignKey,
            targetKey: opts?.targetKey,
        })
    }
}

/**
 * Declares a one-to-many relation: the foreign key lives on the target model.
 *
 * `foreignKey` names the column on the target, `sourceKey` the column on the declaring model it points
 * back at. Left out, the single column of the target carrying `@ForeignKey(() => Declaring)` is used and
 * joined to the declaring model's primary key.
 *
 * @param target Thunk returning the related model class
 *
 * @example
 * ```ts
 * @Table('document_states')
 * export class DocumentState extends QueryableModel<DocumentState, TDocumentStateCA> {
 *     @NamedColumn(DataType.STRING, 'guid')
 *     guid: string
 *
 *     @HasMany(() => TransactionLog, { foreignKey: 'documentGuid', sourceKey: 'guid' })
 *     transactions: TransactionLog[]
 * }
 * ```
 */
export function HasMany(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'hasMany',
            target,
            foreignKey: opts?.foreignKey,
            sourceKey: opts?.sourceKey,
        })
    }
}

/**
 * Declares a one-to-one relation, loading a single related row.
 *
 * The foreign key is expected on the declaring model, exactly as for `@BelongsTo`: `foreignKey` names a
 * column of the declaring model and `targetKey` a column of the target. Left out, the single
 * `@ForeignKey(() => Target)` column is used and joined to the target's primary key.
 *
 * @param target Thunk returning the related model class
 *
 * @example
 * ```ts
 * @Table('transaction_logs')
 * export class TransactionLog extends QueryableModel<TransactionLog, TTransactionLogCA> {
 *     @ForeignKey(() => DocumentState)
 *     @NamedColumn(DataType.STRING, 'document_guid')
 *     documentGuid: string
 *
 *     @HasOne(() => DocumentState, { foreignKey: 'documentGuid', targetKey: 'guid' })
 *     document: DocumentState
 * }
 * ```
 */
export function HasOne(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
            foreignKey: opts?.foreignKey,
            targetKey: opts?.targetKey,
        })
    }
}

/**
 * Declares a many-to-many relation reached through a junction model, which is traversed and flattened
 * so the property holds target rows.
 *
 * `foreignKey` names the junction column pointing back at the declaring model, `otherKey` the junction
 * column pointing at the target, and `sourceKey` the column of the declaring model the foreign key lands
 * on. Both junction columns are resolved from `@ForeignKey` when left out, so a junction referencing the
 * same model twice has to spell them out. There is no `targetKey`: the far hop is the junction's own
 * `@BelongsTo` to the target, and it lands on that relation's `targetKey`.
 *
 * @param target Thunk returning the related model class
 * @param opts `through` is the junction model; the key options name its columns
 *
 * @example
 * ```ts
 * @Table('authors')
 * export class Author extends QueryableModel<Author, TAuthorCA> {
 *     @BelongsToMany(() => Tag, { through: () => AuthorTag })
 *     tags: Tag[]
 * }
 *
 * @Table('people')
 * export class Person extends QueryableModel<Person, TPersonCA> {
 *     @BelongsToMany(() => Person, { through: () => Friendship, foreignKey: 'personId', otherKey: 'friendId' })
 *     friends: Person[]
 * }
 * ```
 */
export function BelongsToMany(
    target: () => Function,
    opts: Omit<TRelationOptions, 'targetKey'> & { through: () => Function },
): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsToMany',
            target,
            through: opts.through,
            foreignKey: opts.foreignKey,
            sourceKey: opts.sourceKey,
            otherKey: opts.otherKey,
        })
    }
}
