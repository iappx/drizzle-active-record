import {
    DataType,
    ModelRegistry,
    NamedColumn,
    PascalCaseNamingStrategy,
    PreserveCaseNamingStrategy,
    QueryableModel,
    SchemaBuilder,
    SnakeCaseNamingStrategy,
    Table,
} from '../../src'

@Table('naming_probe')
class NamingProbe extends QueryableModel<NamingProbe, { firstName: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true })
    id: number

    @NamedColumn(DataType.STRING)
    firstName: string

    @NamedColumn(DataType.STRING, 'ExplicitName')
    overridden: string
}

const columnName = (propertyKey: string): string | undefined =>
    ModelRegistry.require(NamingProbe).columns.find(c => c.propertyKey === propertyKey)?.columnName

describe('naming strategies', () => {
    it('snake_case converts a camelCase property', () => {
        expect(new SnakeCaseNamingStrategy().columnName('firstName')).toBe('first_name')
    })

    it('PascalCase upper-cases the first letter and drops underscores', () => {
        expect(new PascalCaseNamingStrategy().columnName('firstName')).toBe('FirstName')
        expect(new PascalCaseNamingStrategy().columnName('first_name')).toBe('FirstName')
    })

    it('preserve keeps the property name as written', () => {
        expect(new PreserveCaseNamingStrategy().columnName('firstName')).toBe('firstName')
    })
})

describe('SchemaBuilder name resolution', () => {
    it('refuses to build when a column has no name and no strategy is configured', () => {
        expect(() => SchemaBuilder.build()).toThrow(/NamingProbe\.firstName/)
        expect(SchemaBuilder.isBuilt()).toBe(false)
    })

    it('resolves omitted names through the configured strategy and keeps explicit ones', () => {
        SchemaBuilder.setNamingStrategy(new PascalCaseNamingStrategy())
        SchemaBuilder.build()

        expect(columnName('firstName')).toBe('FirstName')
        expect(columnName('overridden')).toBe('ExplicitName')
        expect(columnName('id')).toBe('id')
    })

    it('rejects a strategy change after the schema is built', () => {
        expect(() => SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy()))
            .toThrow(/after the schema has been built/)
    })
})
