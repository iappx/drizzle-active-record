import { DataType, NamedColumn, QueryableModel, Table } from '../../src'

/**
 * Fixture covering every column type the dialect can emit. Kept apart from the main
 * model graph so the shared fixtures stay focused on relations.
 */
@Table('typed_entities')
export class TypedEntity extends QueryableModel<TypedEntity> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.SMALLINT, 'small')
    small: number

    @NamedColumn(DataType.INTEGER, 'whole')
    whole: number

    @NamedColumn(DataType.DOUBLE, 'ratio')
    ratio: number

    @NamedColumn(DataType.DECIMAL(15, 2), 'amount')
    amount: number

    @NamedColumn(DataType.DECIMAL(), 'unsized_amount')
    unsizedAmount: number

    // money: read back as a string so the decimal keeps every digit
    @NamedColumn(DataType.DECIMAL(15, 4, { mode: 'string' }), 'exact_amount')
    exactAmount: string

    // mode without precision/scale
    @NamedColumn(DataType.DECIMAL({ mode: 'string' }), 'exact_unsized_amount')
    exactUnsizedAmount: string

    @NamedColumn(DataType.DECIMAL(20, 0, { mode: 'bigint' }), 'huge_amount')
    hugeAmount: bigint

    @NamedColumn(DataType.BIGINT({ mode: 'bigint' }), 'big_counter')
    bigCounter: bigint

    @NamedColumn(DataType.STRING, 'default_text')
    defaultText: string

    @NamedColumn(DataType.STRING(64), 'short_text')
    shortText: string

    @NamedColumn(DataType.TEXT, 'long_text')
    longText: string

    @NamedColumn(DataType.UUID, 'guid')
    guid: string

    @NamedColumn(DataType.TIME, 'opens_at')
    opensAt: string

    @NamedColumn(DataType.DATE, 'happened_at')
    happenedAt: Date

    @NamedColumn(DataType.BOOLEAN, 'enabled')
    enabled: boolean

    @NamedColumn(DataType.JSONB, 'payload')
    payload: Record<string, unknown>

    @NamedColumn(DataType.ARRAY(DataType.STRING), 'tags')
    tags: string[]

    @NamedColumn(DataType.ARRAY(DataType.INTEGER), 'codes')
    codes: number[]

    // a database type the dialect has no builder for
    @NamedColumn(DataType.CUSTOM('ltree'), 'path')
    path: string
}
