import { DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../../src'

/** { foreignKey } is looked up on the target of a hasMany — this one has no such column. */

@Table('agents')
export class Agent extends QueryableModel<Agent> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @HasMany(() => Ticket, { foreignKey: 'ownerId' })
    tickets: Ticket[]
}

@Table('tickets')
export class Ticket extends QueryableModel<Ticket> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Agent)
    @NamedColumn(DataType.BIGINT, 'reporter_id')
    reporterId: number
}
