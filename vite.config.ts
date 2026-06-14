import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend dev/build config. The analyzer is a separate Python service (see analyzer/).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022' },
});
