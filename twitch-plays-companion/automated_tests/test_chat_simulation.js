/**
 * Mock Chat & System Simulation Test
 * Written by Antigravity
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const BASE_URL = 'http://localhost:8080';

let serverProcess = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function makeRequest(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  return response.json();
}

async function runSimulation() {
  console.log('====================================================');
  console.log('  STARTING MOCK STREAM & VOTE SIMULATION TESTS      ');
  console.log('====================================================');

  // 1. Startup Server
  console.log('\n[SIM 1] Booting Companion Server...');
  serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: '8080' },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[SERVER STDOUT] ${data.toString().trim()}`);
  });
  serverProcess.stderr.on('data', (data) => {
    console.error(`[SERVER STDERR] ${data.toString().trim()}`);
  });

  await sleep(1500);
  console.log('✔ Server online.');

  try {
    // 2. Setup Config
    console.log('\n[SIM 2] Configuring timings for simulation...');
    await makeRequest('/api/config', 'POST', {
      channelName: 'rie_plays',
      queueMode: 'anarchy', // Explicitly start in anarchy to clear any state from prior runs
      userCooldownSeconds: 3, // 3-second cooldown to test spam filter!
      democracyVoteSeconds: 4 // short 4-second vote cycle for fast testing!
    });
    console.log('✔ Server cooldowns and democracy timings set.');

    // 3. Test Spam Cooldown
    console.log('\n[SIM 3] Testing chatter message cooldown filter...');
    console.log('- User @RieLoveChan sends: "a"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'RieLoveChan', message: 'a' });

    console.log('- User @RieLoveChan immediately sends spam: "b" (within 3s)');
    await makeRequest('/api/mock_chat', 'POST', { user: 'RieLoveChan', message: 'b' });

    const status1 = await makeRequest('/api/status');
    console.log(`✔ Verification status: Queue size is ${status1.queueSize} (Expected: 1, since "b" should be throttled!)`);
    if (status1.queueSize !== 1) {
      throw new Error('Cooldown spam filter failed to throttle user inputs!');
    }

    // 4. Test Statistics Aggregates
    console.log('\n[SIM 4] Testing statistics aggregation...');
    console.log('- User @AlexSpeedrun sends: "up+b"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'AlexSpeedrun', message: 'up+b' });
    console.log('- User @CasualChatter sends non-command chat: "Hey guys! Nice stream!"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'CasualChatter', message: 'Hey guys! Nice stream!' });

    const stats = await makeRequest('/api/stats');
    console.log(`✔ Total inputs parsed: ${stats.totalInputs} (Expected: 2 valid commands)`);
    console.log(`✔ Button 'b' press count: ${stats.buttonsPressed['b']} (Expected: 1)`);
    console.log(`✔ Top chatters entries: ${JSON.stringify(stats.topChatters)}`);
    
    if (stats.totalInputs !== 2 || stats.buttonsPressed['b'] !== 1) {
      throw new Error('Statistics tracker reports incorrect metrics!');
    }

    // 5. Test Democracy Mode & Vote Tallying
    console.log('\n[SIM 5] Testing Democracy Mode & Dynamic Tallying...');
    
    // Sleep to allow previous user cooldowns (RieLoveChan, AlexSpeedrun) to fully expire
    console.log('- Waiting 3.5s for prior user cooldowns to expire...');
    await sleep(3500);

    // Switch to democracy
    console.log('- Switching queue mode to DEMOCRACY...');
    await makeRequest('/api/admin', 'POST', { command: 'mode democracy' });

    console.log('- Simulating chatter votes (Voting starts)...');
    console.log('  - @RieLoveChan votes: "a"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'RieLoveChan', message: 'a' });
    
    // Tiny yield to ensure request registers sequentially, no long sleep needed since different users bypass cooldown
    await sleep(100);

    console.log('  - @AlexSpeedrun votes: "down"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'AlexSpeedrun', message: 'down' });
    
    console.log('  - @SpeedyPete votes: "down"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'SpeedyPete', message: 'down' });

    console.log('  - @CasualChatter votes: "select"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'CasualChatter', message: 'select' });

    // Wait for the 4-second democracy vote cycle to conclude (Sleep 4.5s)
    console.log('- Waiting for democracy vote cycle to end and tally votes (Sleeping 4.5s)...');
    await sleep(4500);

    console.log('- Polling for democracy winner...');
    const winnerPoll = await makeRequest('/api/poll');
    console.log(`✔ Democracy winner returned: [ ${winnerPoll.commandText} ] by @${winnerPoll.user} with ${winnerPoll.votes} votes`);
    
    if (winnerPoll.commandText !== 'Down' || winnerPoll.votes !== 2) {
      throw new Error(`Democracy system elected incorrect winner! Got [ ${winnerPoll.commandText} ] with ${winnerPoll.votes} votes, expected 'Down' with 2 votes.`);
    }

    console.log('\n====================================================');
    console.log('   🎉 ALL SIMULATION TESTS PASSED SUCCESSFULLY!    ');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ SIMULATION TEST FAILED:');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      console.log('\nCleaning up. Stopping companion server...');
      serverProcess.kill('SIGINT');
      console.log('Server stopped.');
    }
  }
}

runSimulation();
