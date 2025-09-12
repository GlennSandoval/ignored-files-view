import { defineConfig } from 'vitest/config';
import { builtinModules } from 'module';
import { resolve } from 'node:path';

// Build the VS Code extension with Vite/Rollup.
// - Output CommonJS to work with the extension host.
// - Externalize 'vscode' and Node built-ins.
// - Keep sourcemaps for easier debugging.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,js}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'node18',
    lib: {
      entry: {
        extension: resolve(__dirname, 'src/extension.ts'),
        git: resolve(__dirname, 'src/git.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => (entryName === 'extension' ? 'extension.js' : `${entryName}.js`),
    },
    rollupOptions: {
      external: [
        'vscode',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        exports: 'named',
        manualChunks: undefined,
      },
    },
  },
  esbuild: {
    platform: 'node',
  },
});
