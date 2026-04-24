import type { Tool } from '../types.js';

export const calculatorTool: Tool = {
  name: 'calculator',
  async invoke(params: Record<string, unknown>): Promise<unknown> {
    const expression = params['expression'] as string;
    if (!expression) throw new Error('Missing expression parameter');
    // Safe evaluation: only allow numbers and math operators
    if (!/^[\d\s+\-*/().%^]+$/.test(expression)) {
      throw new Error(`Unsafe expression: ${expression}`);
    }
    try {
      // Convert ^ to ** for exponentiation (JavaScript uses ** not ^)
      const jsExpression = expression.replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${jsExpression})`)();
      return { expression, result };
    } catch {
      throw new Error(`Failed to evaluate: ${expression}`);
    }
  },
};
