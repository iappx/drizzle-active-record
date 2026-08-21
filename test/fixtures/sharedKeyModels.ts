import { BelongsTo, DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../src'

/**
 * Relations that land on a column other than the primary key.
 *
 * `Position` links rows by a plain shared column — every position of the same account — which is
 * the same column on both sides of the join, and self-referencing on top. `parent` / `children`
 * sit beside them unchanged: they still join a foreign key to the primary key.
 */

export type TPositionCA = { accountId: number; title: string; parentId?: number }

@Table('positions')
export class Position extends QueryableModel<Position, TPositionCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    // a plain column, not a foreign key to anything in this fixture
    @NamedColumn(DataType.BIGINT, 'account_id')
    accountId: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @ForeignKey(() => Position)
    @NamedColumn(DataType.BIGINT, 'parent_id')
    parentId: number

    /** the ordinary shape: foreign key → primary key, nothing named */
    @BelongsTo(() => Position, { foreignKey: 'parentId' })
    parent: Position

    /** the ordinary shape, the other way round */
    @HasMany(() => Position, { foreignKey: 'parentId' })
    children: Position[]

    /** the position the account is registered under — both sides on the same plain column */
    @BelongsTo(() => Position, { foreignKey: 'accountId', targetKey: 'accountId' })
    genealogyPosition: Position

    /** every position of the same account */
    @HasMany(() => Position, { foreignKey: 'accountId', sourceKey: 'accountId' })
    treePositions: Position[]

    /** the same link spelled with database column names */
    @HasMany(() => Position, { foreignKey: 'account_id', sourceKey: 'account_id' })
    accountPositions: Position[]
}

/** A natural key: the foreign key holds a guid, while the primary key is a serial id. */
@Table('document_states')
export class DocumentState extends QueryableModel<DocumentState, { guid: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'guid')
    guid: string

    @HasMany(() => TransactionLog, { foreignKey: 'documentGuid', sourceKey: 'guid' })
    transactions: TransactionLog[]
}

@Table('transaction_logs')
export class TransactionLog extends QueryableModel<TransactionLog, { documentGuid: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => DocumentState)
    @NamedColumn(DataType.STRING, 'document_guid')
    documentGuid: string

    // the foreign key column resolves on its own; only the far side has to be named
    @BelongsTo(() => DocumentState, { targetKey: 'guid' })
    document: DocumentState
}
