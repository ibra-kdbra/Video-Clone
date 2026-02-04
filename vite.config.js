import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        additionalData: (content, filePath) => {
          if (filePath.endsWith('_variables.scss') || filePath.endsWith('_mixins.scss')) return content;
          return `
            @use "sass:color";
            @use "@/styles/abstracts/variables" as *;
            @use "@/styles/abstracts/mixins" as *;
            ${content}
          `;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
});
