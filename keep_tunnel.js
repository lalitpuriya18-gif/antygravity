const { exec } = require('child_process');

function startTunnel() {
  console.log('[Tunnel] Starting localtunnel on port 3000...');
  const proc = exec('npx localtunnel --port 3000');

  proc.stdout.on('data', (data) => {
    console.log('[Tunnel]', data.trim());
  });

  proc.stderr.on('data', (data) => {
    console.error('[Tunnel Error]', data.trim());
  });

  proc.on('close', (code) => {
    console.log(`[Tunnel] Process closed with code ${code}. Reconnecting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Error:', err.message);
    setTimeout(startTunnel, 3000);
  });
}

startTunnel();
