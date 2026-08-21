import { BelongsTo, DataType, ForeignKey, NamedColumn, QueryableModel, Table } from '../../../src'

/** Two columns reference Agent, and the relation does not say which one it means. */

@Table('agents')
export class Agent extends QueryableModel<Agent> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number
}

@Table('tickets')
export class Ticket extends QueryableModel<Ticket> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Agent)
    @NamedColumn(DataType.BIGINT, 'reporter_id')
    reporterId: number

    @ForeignKey(() => Agent)
    @NamedColumn(DataType.BIGINT, 'assignee_id')
    assigneeId: number

    @BelongsTo(() => Agent)
    reporter: Agent
}
