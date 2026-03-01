import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isPositiveDecimalString', async: false })
export class IsPositiveDecimalStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (!/^\d+(?:\.\d{1,18})?$/.test(value)) return false;
    return parseFloat(value) > 0;
  }

  defaultMessage(): string {
    return 'amount must be a positive decimal string with up to 18 decimal places (e.g. "9.99")';
  }
}

export function IsPositiveDecimalString(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsPositiveDecimalStringConstraint,
    });
}
