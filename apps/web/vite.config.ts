import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue(),tailwindcss()], build: { outDir: 'build', rollupOptions:{input:{join:fileURLToPath(new URL('./join.html',import.meta.url)),main:fileURLToPath(new URL('./index.html',import.meta.url)),stage:fileURLToPath(new URL('./stage.html',import.meta.url))}} },
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 5173), strictPort: true,
    proxy: { '/demo-avatars/portraits-v1/': `http://127.0.0.1:${process.env.API_PORT ?? 3000}`, '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3000}`,
      '/health': `http://127.0.0.1:${process.env.API_PORT ?? 3000}` } },
});
