import { INamingStrategy } from './INamingStrategy'
import { StringUtils } from '../utils/StringUtils'

/**
 * Naming strategy that maps a property name to `snake_case`.
 *
 * @example
 * ```ts
 * SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
 * new SnakeCaseNamingStrategy().columnName('firstName') // 'first_name'
 * ```
 */
export class SnakeCaseNamingStrategy implements INamingStrategy {
    /** Returns the property name in `snake_case`. */
    public columnName(propertyKey: string): string {
        return StringUtils.toSnakeCase(propertyKey)
    }
}
