import { defineConfig } from 'vite';

export default defineConfig({
  // Caminho do repositório no GitHub Pages
  base: '/game-ia-survival/',

  // main.js usa await no nível do módulo
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