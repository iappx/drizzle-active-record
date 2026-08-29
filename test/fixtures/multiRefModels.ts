import {
    BelongsTo,
    BelongsToMany,
    DataType,
    ForeignKey,
    HasMany,
    NamedColumn,
    QueryableModel,
    Table,
} from '../../src'

/**
 * Models that reference the same target twice — the shape an implicit foreign key cannot
 * resolve. Every relation here says which column it uses.
 */

@Table('wallet_types')
export class WalletType extends QueryableModel<WalletType, { title: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @HasMany(() => TransferRule, { foreignKey: 'sourceWalletTypeId' })
    outgoingRules: TransferRule[]

    @HasMany(() => TransferRule, { foreignKey: 'targetWalletTypeId' })
    incomingRules: TransferRule[]
}

export type TTransferRuleCA = { sourceWalletTypeId: number; targetWalletTypeId: number }

@Table('transfer_rules')
export class TransferRule extends QueryableModel<TransferRule, TTransferRuleCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => WalletType)
    @NamedColumn(DataType.BIGINT, 'source_wallet_type_id')
    sourceWalletTypeId: number

    @ForeignKey(() => WalletType)
    @NamedColumn(DataType.BIGINT, 'target_wallet_type_id')
    targetWalletTypeId: number

    @BelongsTo(() => WalletType, { foreignKey: 'sourceWalletTypeId' })
    sourceWalletType: WalletType

    @BelongsTo(() => WalletType, { foreignKey: 'targetWalletTypeId' })
    targetWalletType: WalletType
}

@Table('people')
export class Person extends QueryableModel<Person, { name: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'name')
    name: string

    @ForeignKey(() => Person)
    @NamedColumn(DataType.BIGINT, 'parent_id')
    parentId: number

    @ForeignKey(() => Person)
    @NamedColumn(DataType.BIGINT, 'sponsor_id')
    sponsorId: number

    @BelongsTo(() => Person, { foreignKey: 'parentId' })
    parent: Person

    @BelongsTo(() => Person, { foreignKey: 'sponsorId' })
    sponsor: Person

    @HasMany(() => Person, { foreignKey: 'parentId' })
    children: Person[]

    // the junction reaches Person from both ends: both keys have to be spelled out
    @BelongsToMany(() => Person, { through: () => Friendship, foreignKey: 'personId', otherKey: 'friendId' })
    friends: Person[]
}

@Table('friendships')
export class Friendship extends QueryableModel<Friendship, { personId: number; friendId: number }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Person)
    @NamedColumn(DataType.BIGINT, 'person_id')
    personId: number

    @ForeignKey(() => Person)
    @NamedColumn(DataType.BIGINT, 'friend_id')
    friendId: number

    @BelongsTo(() => Person, { foreignKey: 'personId' })
    person: Person

    @BelongsTo(() => Person, { foreignKey: 'friendId' })
    friend: Person
}
