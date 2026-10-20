import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// basic-ssl gives the dev server a self-signed certificate so the Quest
// browser can open it over the LAN (WebXR requires a secure context).
export default defineConfig(({ command, isPreview }) => ({
  base: './',
  plugins: command === 'serve' && !isPreview ? [basicSsl()] : [],
  build: {
    outDir: 'dist',
    target: 'es2022',
    // The Rapier compat build inlines its WebAssembly as base64.
    chunkSizeWarningLimit: 5000,
  },
}));
