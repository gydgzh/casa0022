import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for getUserMedia on non-localhost origins (i.e. when
// the iPad connects to the Mac over the LAN). basicSsl gives us a
// self-signed cert; iPad Safari will ask the user to accept it once.
//
// Override with HTTP_ONLY=1 (used by `npm run dev:http`) when you only
// need to load ?mode=demo on the Mac itself — getUserMedia isn't called,
// so HTTP on 127.0.0.1 works and avoids the self-signed cert popup.
const HTTP_ONLY = process.env.HTTP_ONLY === '1';

export default defineConfig({
  plugins: HTTP_ONLY ? [] : [basicSsl()],
  server: {
    host: HTTP_ONLY ? '127.0.0.1' : '0.0.0.0',
    port: 5173,
    https: !HTTP_ONLY,
    cors: true,
    // Proxy mqtt-over-WebSocket through Vite's HTTPS port so the iPad page
    // (loaded over wss://) can subscribe without mixed-content errors.
    // Mosquitto's WS listener (mosquitto/mosquitto.conf) is on 127.0.0.1:9001.
    proxy: {
      '/mqtt': {
        target: 'ws://127.0.0.1:9001',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mqtt/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true
  },
  esbuild: {
    target: 'es2022'
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' }
  }
});
