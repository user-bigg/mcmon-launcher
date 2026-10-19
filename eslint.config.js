import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

const rendererImports = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['node:*', 'electron'], message: 'Renderer has no access to Node and Electron' },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'out/',
      'release/',
      'coverage/',
      'design/',
      'build/',
      'patches/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Build markup with the DOM API or DOMParser' },
        { property: 'outerHTML', message: 'Build markup with the DOM API or DOMParser' },
      ],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: globals.browser,
    },
    rules: {
      ...rendererImports,
      'vue/no-v-html': 'error',
      'vue/no-v-text-v-html-on-component': 'error',
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/require-default-prop': 'off',
      'vue/no-bare-strings-in-template': 'error',
    },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'scripts/**/*.ts',
      '*.ts',
      '*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node, parserOptions: { projectService: false } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: rendererImports,
  },
  {
    files: ['src/renderer/renderer-rules.test.ts', 'src/renderer/selection-rules.test.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  prettier,
);
