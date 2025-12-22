import { defineConfig } from 'tsdown';

export default defineConfig({
  exports: false,
  entry: './src/**.ts',
  external: ['bun'],
  minify: true,
});
