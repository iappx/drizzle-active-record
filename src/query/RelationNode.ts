import { ModelRegistry } from '../registry/ModelRegistry'
import { RelationForeignKey } from '../schema/RelationForeignKey'
import { TRelationMeta, TTableMeta } from '../types/metadata'
import { QueryNode } from './QueryNode'

/**
 * Where a relation's node hangs in the query tree.
 *
 * Drizzle's relational query builder has no one-hop many-to-many, so a `belongsToMany` needs an
 * extra level: the node stored under the relation's key is the **junction**, and the target's node
 * hangs below it under the junction's own relation key.
 */
export class RelationNode {
    /**
     * Attaches `targetNode` under `parentNode` through the junction of a `belongsToMany` relation.
     *
     * Creates the junction node and stores it at `rel.propertyKey`, then hangs `targetNode` under
     * the junction's `belongsTo` relation to the target.
     *
     * @returns The target node, ready to be filled in
     * @throws {Error} When the relation declares no `through` model, or the junction has no
     *     `belongsTo` relation to the target
     *
     * @example
     * ```ts
     * const tagsNode = RelationNode.attachManyToMany(authorNode, authorMeta.relations[0])
     * tagsNode.where.push(eq(tagsTable.label, 'ts'))
     * ```
     */
    public static attachManyToMany(
        parentNode: QueryNode,
        rel: TRelationMeta,
        targetNode: QueryNode = new QueryNode(),
    ): QueryNode {
        if (!rel.through) {
            throw new Error(`belongsToMany relation "${rel.propertyKey}" has no through model`)
        }
        const throughMeta = ModelRegistry.require(rel.through())
        const targetCtor = rel.target()
        const targetRel = RelationForeignKey.junctionRelation(throughMeta, targetCtor, rel.otherKey)
        if (!targetRel) {
            const via = rel.otherKey ? ` on column "${rel.otherKey}" (from { otherKey })` : ''
            throw new Error(
                `Junction ${throughMeta.tableName} has no belongsTo relation to `
                + `${(targetCtor as { name?: string }).name}${via}`,
            )
        }
        const junctionNode = new QueryNode()
        junctionNode.with[targetRel.propertyKey] = targetNode
        parentNode.with[rel.propertyKey] = junctionNode
        return targetNode
    }
}
