import { defineConfig } from 'vite';

export default defineConfig({
  // main.js usa `await` no nível do módulo (verifica os assets opcionais do hospital).
  build: { target: 'esnext' },
  server: {
    watch: {
      // Ferramentas de captura/download ficam fora do watcher para não
      // derrubar o servidor quando o script grava arquivos temporários.
      ignored: [
        '**/.tools/**', '**/.npm-cache/**', '**/.build-tmp/**',
        '**/screenshots/**', '**/dist/**', '**/*.tmpdir/**', '**/.*.tmp',
      ],
    },
  },
});
