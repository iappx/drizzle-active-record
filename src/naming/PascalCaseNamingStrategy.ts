import { INamingStrategy } from './INamingStrategy'
import { StringUtils } from '../utils/StringUtils'

export class PascalCaseNamingStrategy implements INamingStrategy {
    public columnName(propertyKey: string): string {
        return StringUtils.toPascalCase(propertyKey)
    }
}
