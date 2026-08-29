import { INamingStrategy } from './INamingStrategy'
import { StringUtils } from '../utils/StringUtils'

/**
 * Naming strategy that maps a property name to `PascalCase`.
 *
 * @example
 * ```ts
 * SchemaBuilder.setNamingStrategy(new PascalCaseNamingStrategy())
 * new PascalCaseNamingStrategy().columnName('firstName') // 'FirstName'
 * new PascalCaseNamingStrategy().columnName('first_name') // 'FirstName'
 * ```
 */
export class PascalCaseNamingStrategy implements INamingStrategy {
    /** Returns the property name in `PascalCase`. */
    public columnName(propertyKey: string): string {
        return StringUtils.toPascalCase(propertyKey)
    }
}
