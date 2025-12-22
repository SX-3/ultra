import antfu from '@antfu/eslint-config';

export default antfu({
  typescript: true,
  formatters: true,
  stylistic: {
    semi: true,
  },
  rules: {
    'antfu/if-newline': ['off'],
    // 'no-console': ['off'],
    'node/prefer-global/buffer': ['off'],
  },

  markdown: {
    overrides: {
      'import/first': ['off'],
      'prefer-const': ['off'],
      'perfectionist/sort-imports': ['off'],
      'import/no-duplicates': ['off'],
    },
  },

});
