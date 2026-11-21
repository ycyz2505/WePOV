import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/android/android/**',
      // 这些文件不属于任何 workspace 的 tsconfig 项目，类型感知规则无法解析。
      'e2e/**',
      'scripts/**',
      'playwright.config.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // SQL 行的运行时形状由手写行类型描述，跨边界仍可能落到 any；
      // 结构正确性由 tsc 的显式行类型和集成测试保证。
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/require-await': 'off',
      // 多处断言用于向运行时边界（SQL、JSON、DOM）明确类型，属于有意为之。
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
)
