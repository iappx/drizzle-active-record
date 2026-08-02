import { INamingStrategy } from './INamingStrategy'
import { StringUtils } from '../utils/StringUtils'

export class SnakeCaseNamingStrategy implements INamingStrategy {
    public columnName(propertyKey: string): string {
        return StringUtils.toSnakeCase(propertyKey)
    }
}
