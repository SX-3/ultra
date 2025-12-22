import type { GitHooksConfig } from 'bun-git-hooks';

export default {
  'pre-commit': 'bun run test && bun run lint',
  'verbose': true,
} as GitHooksConfig;
