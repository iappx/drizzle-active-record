import { BelongsTo, DataType, ForeignKey, NamedColumn, QueryableModel, Table } from '../../../src'

/** { foreignKey } names a column the model does not have (a typo, or a renamed property). */

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

    @BelongsTo(() => Agent, { foreignKey: 'reportedById' })
    reporter: Agent
}
