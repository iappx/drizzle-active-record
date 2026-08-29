import { INamingStrategy } from './INamingStrategy'

/**
 * Naming strategy that uses the property name as written, with no conversion.
 *
 * @example
 * ```ts
 * SchemaBuilder.setNamingStrategy(new PreserveCaseNamingStrategy())
 * new PreserveCaseNamingStrategy().columnName('firstName') // 'firstName'
 * ```
 */
export class PreserveCaseNamingStrategy implements INamingStrategy {
    /** Returns the property name unchanged. */
    public columnName(propertyKey: string): string {
        return propertyKey
    }
}
