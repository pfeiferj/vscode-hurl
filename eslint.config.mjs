import babelParser from '@babel/eslint-parser';

export default [{
  files: ['src/**/*.ts'],
  languageOptions: {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: { plugins: ['@babel/plugin-syntax-typescript'] },
    },
  },
  rules: {
    curly: 'error',
    eqeqeq: 'error',
    'no-debugger': 'error',
    'no-duplicate-imports': 'error',
    'no-unreachable': 'error',
    'prefer-const': 'error',
  },
}];
