import { DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../../src'

/** { sourceKey } names a column the *declaring* model does not have. */

@Table('agents')
export class Agent extends QueryableModel<Agent> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'code')
    code: string

    @HasMany(() => Ticket, { foreignKey: 'reporterCode', sourceKey: 'agentCode' })
    tickets: Ticket[]
}

@Table('tickets')
export class Ticket extends QueryableModel<Ticket> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Agent)
    @NamedColumn(DataType.STRING, 'reporter_code')
    reporterCode: string
}
