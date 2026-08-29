import { TWhere } from './types'

/**
 * What `Model.query().where(...).exists()` returns until an outer query resolves it.
 *
 * Carries the target model and its conditions unbuilt; the outer query supplies the foreign key
 * and the alias the `EXISTS` correlates to.
 */
export class PendingExists {
    /** Records the target of an `EXISTS` an outer query has yet to build. */
    constructor(
        /** Model class the sub-query reads from. */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        public readonly model: new () => any,
        /** Conditions on the target rows, ANDed together inside the sub-query. */
        public readonly conditions: TWhere[],
        /** Property key of the relation on the outer model, when several point at `model`. */
        public readonly as?: string,
        /** Whether the outer query renders `NOT EXISTS` instead of `EXISTS`. */
        public readonly negated = false,
    ) {}

    /**
     * Returns a copy with `negated` flipped, leaving this instance untouched.
     *
     * @example
     * ```ts
     * const pending = Book.query().where({ isPublished: true }).exists()
     * const withoutPublished = pending.negate()
     * ```
     */
    public negate(): PendingExists {
        return new PendingExists(this.model, this.conditions, this.as, !this.negated)
    }
}
