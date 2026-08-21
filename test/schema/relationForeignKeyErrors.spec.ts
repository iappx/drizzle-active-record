/**
 * Every case here has to build a schema of its own: the model registry and the SchemaBuilder are
 * process-wide singletons, so each fixture is loaded into an isolated module registry.
 */
const buildWith = (fixture: string): void => {
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SchemaBuilder } = require('../../src')
        require(fixture)
        SchemaBuilder.build()
    })
}

describe('a relation that cannot pick a foreign key on its own', () => {
    it('fails the build when a belongsTo has two candidate columns', () => {
        expect(() => buildWith('../fixtures/invalid/ambiguousBelongsTo'))
            .toThrow(/Relation "Ticket\.reporter" is ambiguous/)
    })

    it('names the candidates and the option that resolves them', () => {
        expect(() => buildWith('../fixtures/invalid/ambiguousBelongsTo'))
            .toThrow(/\('reporterId', 'assigneeId'\)[\s\S]*\{ foreignKey: '<propertyKey>' \}/)
    })

    it('fails the build when a hasMany has two candidate columns on the target', () => {
        expect(() => buildWith('../fixtures/invalid/ambiguousHasMany'))
            .toThrow(/Relation "Agent\.tickets" is ambiguous: model Ticket has 2 columns referencing Agent/)
    })
})

describe('a relation naming a column that does not exist', () => {
    it('fails the build for a belongsTo, pointing at the declaring model', () => {
        expect(() => buildWith('../fixtures/invalid/unknownBelongsToKey'))
            .toThrow(/Relation "Ticket\.reporter" declares \{ foreignKey: 'reportedById' \}, but model Ticket has no such column/)
    })

    it('fails the build for a hasMany, pointing at the target model', () => {
        expect(() => buildWith('../fixtures/invalid/unknownHasManyKey'))
            .toThrow(/Relation "Agent\.tickets" declares \{ foreignKey: 'ownerId' \}, but model Ticket has no such column/)
    })
})

describe('a relation naming a column on the far side of the join that does not exist', () => {
    it('fails the build for a { targetKey }, pointing at the target model', () => {
        expect(() => buildWith('../fixtures/invalid/unknownTargetKey'))
            .toThrow(/Relation "Ticket\.reporter" declares \{ targetKey: 'agentCode' \}, but model Agent has no such column/)
    })

    it('fails the build for a { sourceKey }, pointing at the declaring model', () => {
        expect(() => buildWith('../fixtures/invalid/unknownSourceKey'))
            .toThrow(/Relation "Agent\.tickets" declares \{ sourceKey: 'agentCode' \}, but model Agent has no such column/)
    })

    it('says a property key is expected, and that a column name works too', () => {
        expect(() => buildWith('../fixtures/invalid/unknownTargetKey'))
            .toThrow(/Expected the property key of a column on Agent \(its database column name is accepted too\)/)
    })
})
