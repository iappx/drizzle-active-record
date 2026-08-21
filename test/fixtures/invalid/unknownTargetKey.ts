import { BelongsTo, DataType, ForeignKey, NamedColumn, QueryableModel, Table } from '../../../src'

/** { targetKey } names a column the *target* model does not have. */

@Table('agents')
export class Agent extends QueryableModel<Agent> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'code')
    code: string
}

@Table('tickets')
export class Ticket extends QueryableModel<Ticket> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Agent)
    @NamedColumn(DataType.STRING, 'reporter_code')
    reporterCode: string

    @BelongsTo(() => Agent, { targetKey: 'agentCode' })
    reporter: Agent
}
