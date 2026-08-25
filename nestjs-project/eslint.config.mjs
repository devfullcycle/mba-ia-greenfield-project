// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Test files legitimately deal with loosely-typed values (mocks built as
    // `any`, third-party response bodies like supertest's `Response.body`)
    // that don't merit the same rigor as production `src/` code. Extends the
    // same relaxed posture already applied above (no-explicit-any: off,
    // no-unsafe-argument: warn) to the remaining no-unsafe-* rules, scoped to
    // test files only.
    files: [
      '**/*.spec.ts',
      '**/*.integration-spec.ts',
      'test/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // `expect(mock.method).toHaveBeenCalledWith(...)` on a jest.Mocked<T>
      // passes a bare method reference — jest never invokes it as `this.method()`,
      // it only inspects call history, so the "unintended this" risk this rule
      // guards against does not apply to jest assertions.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
