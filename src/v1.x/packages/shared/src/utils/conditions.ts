export type ComparisonRule =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "MATCHES"
  | "STARTS_WITH"
  | "ENDS_WITH";
export type LogicalRule = "AND" | "OR" | "NOT";
export type ExistenceRule = "EXISTS" | "NOT_EXISTS";

export type Rule = ComparisonRule | LogicalRule | ExistenceRule;

export interface BaseCondition {
  rule: Rule;
  path?: string;
}

export interface ComparisonCondition extends BaseCondition {
  rule: ComparisonRule;
  value: any;
}

export interface LogicalCondition extends BaseCondition {
  rule: LogicalRule;
  conditions: Condition[];
}

export interface ExistenceCondition extends BaseCondition {
  rule: ExistenceRule;
}

export type Condition = ComparisonCondition | LogicalCondition | ExistenceCondition;

export function executeConditions({
  conditions,
  value,
}: {
  conditions?: Condition[];
  value: any;
}): boolean {
  // If no conditions, consider it a pass
  if (!conditions?.length) return true;

  // Run all conditions (implicit AND)
  return conditions.every((condition) => executeCondition(condition, value));
}

function executeCondition(condition: Condition, value: any): boolean {
  const targetValue = condition.path ? getValueFromPath(value, condition.path) : value;

  switch (condition.rule) {
    // Logical
    case "AND":
      return (condition as LogicalCondition).conditions.every((c) => executeCondition(c, value));
    case "OR":
      return (condition as LogicalCondition).conditions.some((c) => executeCondition(c, value));
    case "NOT":
      return !(condition as LogicalCondition).conditions.every((c) => executeCondition(c, value));

    // Comparison
    case "EQUALS":
      return targetValue === (condition as ComparisonCondition).value;
    case "NOT_EQUALS":
      return targetValue !== (condition as ComparisonCondition).value;
    case "GREATER_THAN":
      return targetValue > (condition as ComparisonCondition).value;
    case "LESS_THAN":
      return targetValue < (condition as ComparisonCondition).value;
    case "CONTAINS":
      return (
        Array.isArray(targetValue) && targetValue.includes((condition as ComparisonCondition).value)
      );
    case "NOT_CONTAINS":
      return (
        Array.isArray(targetValue) &&
        !targetValue.includes((condition as ComparisonCondition).value)
      );
    case "MATCHES":
      return new RegExp((condition as ComparisonCondition).value).test(String(targetValue));
    case "STARTS_WITH":
      return String(targetValue).startsWith((condition as ComparisonCondition).value);
    case "ENDS_WITH":
      return String(targetValue).endsWith((condition as ComparisonCondition).value);

    // Existence
    case "EXISTS":
      return targetValue !== undefined && targetValue !== null;
    case "NOT_EXISTS":
      return targetValue === undefined || targetValue === null;
  }
}

function getValueFromPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}
