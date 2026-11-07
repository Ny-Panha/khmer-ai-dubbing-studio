import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import readline from 'node:readline';

/**
 * Custom Vite plugin: Enables single-key shortcuts (just 'r', 'u', 'o', 'c', 'q')
 * without requiring the user to press Enter.
 */
let isRawActive = false;
let activeServer = null;

function singleKeyShortcutsPlugin() {
  return {
    name: 'single-key-shortcuts',
    configureServer(server) {
      activeServer = server;

      if (!isRawActive && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);

          process.stdin.on('keypress', async (str, key) => {
            if (!key || !activeServer) return;

            // Ctrl + C: Exit cleanly
            if (key.ctrl && key.name === 'c') {
              try {
                await activeServer.close();
              } finally {
                process.exit(0);
              }
            }

            // Just 'r' (without Enter) -> Restart Vite server!
            if (key.name === 'r' && !key.ctrl && !key.meta) {
              activeServer.config.logger.info('\n[vite] single-key [r] pressed -> restarting server...', { timestamp: true });
              await activeServer.restart();
              return;
            }

            // Just 'u' -> Print URLs
            if (key.name === 'u' && !key.ctrl && !key.meta) {
              activeServer.config.logger.info('');
              activeServer.printUrls();
              return;
            }

            // Just 'o' -> Open in browser
            if (key.name === 'o' && !key.ctrl && !key.meta) {
              activeServer.openBrowser();
              return;
            }

            // Just 'c' -> Clear console
            if (key.name === 'c' && !key.ctrl && !key.meta) {
              activeServer.config.logger.clearScreen('error');
              return;
            }

            // Just 'q' -> Quit
            if (key.name === 'q' && !key.ctrl && !key.meta) {
              try {
                await activeServer.close();
              } finally {
                process.exit(0);
              }
            }
          });

          isRawActive = true;
        } catch {
          // Graceful fallback if TTY raw mode cannot be set
        }
      }
    },
  };
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:5000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), singleKeyShortcutsPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
        timeout: 1800000,
        proxyTimeout: 1800000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            console.warn(`[Vite Proxy] Backend API proxy notice (${req.url}):`, err.message);
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: `Backend server is temporarily unreachable (${err.code || err.message}). Please verify backend is running on port 5000.`
              }));
            }
          });
        },
      },
      '/uploads': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
        timeout: 1800000,
        proxyTimeout: 1800000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            console.warn(`[Vite Proxy] Media uploads proxy notice (${req.url}):`, err.message);
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: `Media upload/file proxy error (${err.code || err.message}).`
              }));
            }
          });
        },
      },
    },
  },
});
