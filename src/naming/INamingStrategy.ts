/**
 * Derives database column names for properties whose decorator omits an explicit one.
 *
 * Installed with `SchemaBuilder.setNamingStrategy` before the schema is built. A column declared with
 * an explicit name never reaches the strategy.
 *
 * @example
 * ```ts
 * class LowerCaseNamingStrategy implements INamingStrategy {
 *     public columnName(propertyKey: string): string {
 *         return propertyKey.toLowerCase()
 *     }
 * }
 *
 * SchemaBuilder.setNamingStrategy(new LowerCaseNamingStrategy())
 * ```
 */
export interface INamingStrategy {
    /**
     * Returns the column name for a model property.
     *
     * @param propertyKey Name of the property as written on the model class
     */
    columnName(propertyKey: string): string
}
