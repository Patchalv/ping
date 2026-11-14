// ESLint holds what Biome can't check: the type-aware rules, and the AST rules behind
// docs/conventions.md. Everything else is Biome's job. The type-aware rules mainly
// protect the transaction wrapper: an unawaited query can escape the app.staff_id
// transaction. A disable comment must give its reason after `--`
// (scripts/check-ts-directives.ts checks it).
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    files: [
      'apps/*/src/**/*.{ts,tsx}',
      'packages/*/src/**/*.ts',
      'scripts/**/*.ts',
      '.claude/hooks/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  // conventions.md › Server routes: input only through c.req.valid(...), and errors are
  // thrown, never returned with a status.
  {
    files: ['apps/server/src/features/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.property.name='req'][callee.property.name=/^(json|param|query)$/]",
          message: 'Read input only through c.req.valid(...), after validate().',
        },
        {
          selector:
            "CallExpression[callee.property.name='json'][arguments.1.type='Literal'][arguments.1.value>=400]",
          message:
            'Throw a typed error (NotFoundError, ForbiddenError, …); routes never set error statuses.',
        },
      ],
    },
  },
  // conventions.md › The web app: effects only to sync with something outside React.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^use(Layout)?Effect$/], CallExpression[callee.property.name=/^use(Layout)?Effect$/]",
          message:
            'No effect for fetching, derived state or reacting to events. To sync with something outside React, disable this rule with a reason after `--`.',
        },
      ],
    },
  },
);
