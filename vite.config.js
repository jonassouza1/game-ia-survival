import { defineConfig } from 'vite';

export default defineConfig({
  // main.js usa `await` no nível do módulo (verifica os assets opcionais do hospital).
  build: {
    target: 'esnext',
    // Os modelos/texturas já estão comprimidos; evita varrer public/ calculando tamanhos gzip à toa.
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
  // host: true expõe o servidor na rede local, para abrir no celular (http://IP-DO-PC:5173).
  preview: { host: true },
  server: {
    host: true,
    watch: {
      ignored: [
        '**/.tools/**', '**/.npm-cache/**', '**/.build-tmp/**',
        '**/screenshots/**', '**/dist/**', '**/*.tmpdir/**', '**/.*.tmp',
      ],
    },
  },
});