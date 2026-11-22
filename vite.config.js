import { defineConfig } from 'vite';

export default defineConfig({
  // main.js usa `await` no nível do módulo (verifica os assets opcionais do hospital).
  build: { target: 'esnext' },
  server: {
    watch: {
      ignored: [
        '**/.tools/**', '**/.npm-cache/**', '**/.build-tmp/**',
        '**/screenshots/**', '**/dist/**', '**/*.tmpdir/**', '**/.*.tmp',
      ],
    },
  },
});