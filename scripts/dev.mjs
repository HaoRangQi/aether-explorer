import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const preferredPort = Number(process.env.AETHER_DEV_PORT || process.env.VITE_DEV_PORT || 41873);

function probePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await probePort(port)) return port;
  }
  throw new Error(`No available dev port found from ${startPort} to ${startPort + 99}`);
}

const port = await findAvailablePort(preferredPort);
const tempDir = mkdtempSync(join(tmpdir(), 'aether-tauri-dev-'));
const configPath = join(tempDir, 'tauri.dev.json');

writeFileSync(configPath, JSON.stringify({
  build: {
    devUrl: `http://localhost:${port}`,
    beforeDevCommand: `vite --host=0.0.0.0 --port=${port} --strictPort`,
  },
}, null, 2));

console.log(`[aether-dev] using frontend port ${port}`);

const child = spawn('npx', ['@tauri-apps/cli', 'dev', '--config', configPath], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_PORT: String(port) },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
