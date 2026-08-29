import { BelongsTo, DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../src'

/** Relations that land on a column other than the primary key. */

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

    @BelongsTo(() => Position, { foreignKey: 'parentId' })
    parent: Position

    @HasMany(() => Position, { foreignKey: 'parentId' })
    children: Position[]

    @BelongsTo(() => Position, { foreignKey: 'accountId', targetKey: 'accountId' })
    genealogyPosition: Position

    @HasMany(() => Position, { foreignKey: 'accountId', sourceKey: 'accountId' })
    treePositions: Position[]

    @HasMany(() => Position, { foreignKey: 'account_id', sourceKey: 'account_id' })
    accountPositions: Position[]
}

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
