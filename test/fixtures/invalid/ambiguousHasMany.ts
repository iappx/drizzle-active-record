import { DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../../src'

/** The target reaches back twice, and the hasMany does not say through which column. */

@Table('agents')
export class Agent extends QueryableModel<Agent> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @HasMany(() => Ticket)
    tickets: Ticket[]
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
}
