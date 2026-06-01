const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, 'server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function test() {
  console.log("Starting server...");
  const server = spawn('node', [SERVER_PATH], { stdio: 'inherit' });
  await sleep(1500);

  console.log("Configuring...");
  await fetch('http://localhost:8080/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCooldownSeconds: 0 })
  });

  console.log("Injecting commands...");
  await fetch('http://localhost:8080/api/mock_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'RieLoveChan', message: 'up+a' })
  });
  await fetch('http://localhost:8080/api/mock_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'AlexSpeedrun', message: 'hold b 35' })
  });
  await fetch('http://localhost:8080/api/mock_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'CasualChatter', message: 'u d l r' })
  });

  console.log("Fetching status...");
  const statusRes = await fetch('http://localhost:8080/api/status');
  const status = await statusRes.json();
  console.log("Status queueSize:", status.queueSize);

  console.log("Polling items...");
  while(true) {
    const res = await fetch('http://localhost:8080/api/poll');
    const item = await res.json();
    if (Object.keys(item).length === 0) break;
    console.log("Polled item:", item.user, "->", item.commandText);
  }

  console.log("Stopping server...");
  server.kill('SIGINT');
}

test();
