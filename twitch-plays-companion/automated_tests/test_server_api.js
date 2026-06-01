/**
 * Integration Test: Companion Server REST APIs & Queue State Machines
 * Written by Antigravity
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const BASE_URL = 'http://localhost:8080';

let serverProcess = null;

// Utility sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Execute an HTTP fetch request
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
  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status} on ${method} ${endpoint}`);
  }
  return response.json();
}

async function runTests() {
  console.log('====================================================');
  console.log('  STARTING INTEGRATION TESTS FOR COMPANION SERVER   ');
  console.log('====================================================');

  // 1. Launch the Server
  console.log('\n[TEST 1] Starting server process...');
  serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: '8080' },
    stdio: 'pipe'
  });

  // Handle server crash or premature exit
  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\n❌ Server exited prematurely with code ${code}`);
      process.exit(1);
    }
  });

  // Wait 1.5 seconds for server boot-up
  await sleep(1500);
  console.log('✔ Server started successfully.');

  try {
    // 2. Test GET Configuration
    console.log('\n[TEST 2] Verifying GET /api/config...');
    const config = await makeRequest('/api/config');
    console.log(`✔ Config loaded. Active console: ${config.activeConsole}, Mode: ${config.queueMode}`);
    // 3. Test POST Configuration
    console.log('\n[TEST 3] Verifying POST /api/config...');
    const newConfig = {
      channelName: 'test_streamer',
      queueMode: 'anarchy',
      holdFrames: 12,
      releaseFrames: 6,
      userCooldownSeconds: 0 // set to 0 for instant multiple inputs in testing
    };
    const updateResult = await makeRequest('/api/config', 'POST', newConfig);
    if (!updateResult.success || updateResult.config.channelName !== 'test_streamer') {
      throw new Error('Failed to update config settings!');
    }
    console.log('✔ Configuration updated and verified successfully.');

    // 4. Test Chat Command Parsing & Queue FIFO
    console.log('\n[TEST 4] Simulating Twitch Chat button inputs...');
    
    // Inject mock message
    const chatMsg1 = { user: 'RieLoveChan', message: 'up+a' };
    const chatMsg2 = { user: 'AlexSpeedrun', message: 'hold b 35' };
    const chatMsg3 = { user: 'CasualChatter', message: 'u d l r' }; // sequence!

    console.log(`- Injecting chat message from @${chatMsg1.user}: "${chatMsg1.message}"`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg1);
    
    console.log(`- Injecting chat message from @${chatMsg2.user}: "${chatMsg2.message}"`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg2);

    console.log(`- Injecting chat message from @${chatMsg3.user}: "${chatMsg3.message}" (Sequence)`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg3);

    // Get Status to verify queue size
    const status = await makeRequest('/api/status');
    console.log(`✔ Verification status: Queue size is ${status.queueSize} items (Expected: 6)`);
    if (status.queueSize !== 6) {
      throw new Error(`Queue size mismatch! Got ${status.queueSize}, expected 6.`);
    }

    // 5. Test Poll API Consumption
    console.log('\n[TEST 5] Testing /api/poll inputs consumer (BizHawk simulator)...');
    
    // Poll first input (up+a)
    const poll1 = await makeRequest('/api/poll');
    console.log(`✔ Poll 1 returned: [ ${poll1.commandText} ] by @${poll1.user}`);
    if (poll1.user !== 'RieLoveChan' || !poll1.buttons['Up'] || !poll1.buttons['A']) {
      throw new Error('Poll 1 values incorrect!');
    }

    // Poll second input (hold b 35)
    const poll2 = await makeRequest('/api/poll');
    console.log(`✔ Poll 2 returned: [ ${poll2.commandText} ] by @${poll2.user} (Hold: ${poll2.holdFrames}f)`);
    if (poll2.user !== 'AlexSpeedrun' || !poll2.buttons['B'] || poll2.holdFrames !== 35) {
      throw new Error('Poll 2 values/hold frames incorrect!');
    }

    // Poll third input (u in sequence)
    const poll3 = await makeRequest('/api/poll');
    console.log(`✔ Poll 3 returned: [ ${poll3.commandText} ] by @${poll3.user}`);
    if (poll3.commandText !== 'Up') {
      throw new Error('Poll 3 sequence parsing incorrect!');
    }

    // 6. Test Admin Command Pause Overrides
    console.log('\n[TEST 6] Testing administrative pause controls...');
    
    // Trigger Pause
    console.log('- Triggering local admin pause...');
    const pauseResult = await makeRequest('/api/admin', 'POST', { command: 'pause' });
    console.log(`- Status: ${pauseResult.message}`);

    const statusAfterPause = await makeRequest('/api/status');
    console.log(`✔ Verification status: isPaused is ${statusAfterPause.isPaused}`);
    if (!statusAfterPause.isPaused) {
      throw new Error('Server should be paused!');
    }

    // Poll during pause (should return empty)
    const pollPause = await makeRequest('/api/poll');
    console.log(`✔ Polling during pause returned: ${JSON.stringify(pollPause)} (Expected empty)`);
    if (Object.keys(pollPause).length > 0) {
      throw new Error('Polling during pause should return empty JSON!');
    }

    // Trigger Resume
    console.log('- Triggering local admin resume...');
    await makeRequest('/api/admin', 'POST', { command: 'resume' });

    const statusAfterResume = await makeRequest('/api/status');
    if (statusAfterResume.isPaused) {
      throw new Error('Server should be unpaused!');
    }

    // Poll after resume (should return next item in sequence: 'd')
    const pollResume = await makeRequest('/api/poll');
    console.log(`✔ Polling after resume returned: [ ${pollResume.commandText} ] (Expected 'Down')`);
    if (pollResume.commandText !== 'Down') {
      throw new Error('Polling after resume failed to fetch next command!');
    }

    // 7. Test Admin Clear Command
    console.log('\n[TEST 7] Testing administrative queue clear controls...');
    console.log('- Triggering local admin clear...');
    await makeRequest('/api/admin', 'POST', { command: 'clear' });
    
    const statusAfterClear = await makeRequest('/api/status');
    console.log(`✔ Verification status: Queue size is now ${statusAfterClear.queueSize} (Expected: 0)`);
    if (statusAfterClear.queueSize !== 0) {
      throw new Error('Queue was not cleared successfully!');
    }

    console.log('\n====================================================');
    console.log('   🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!    ');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ TEST FAILED:');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    // 8. Clean up and Shutdown Server
    if (serverProcess) {
      console.log('\nCleaning up. Stopping companion server...');
      serverProcess.kill('SIGINT');
      console.log('Server stopped.');
    }
  }
}

runTests();
