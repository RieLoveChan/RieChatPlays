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
  serverProcess.stdout.pipe(process.stdout);
  serverProcess.stderr.pipe(process.stderr);

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
    console.log('\n[TEST 3] Verifying POST /api/config with custom button mappings & presses cap...');
    const newConfig = {
      channelName: 'test_streamer',
      queueMode: 'anarchy',
      activeConsole: 'nes',
      holdFrames: 12,
      releaseFrames: 6,
      userCooldownSeconds: 0, // no cooldown for quick multiple inputs
      buttonPressesCap: 5,
      inputPrefix: "",
      inputSuffix: "",
      buttonMap: {
        nes: {
          'Up': 'up, u, arriba',
          'Down': 'down, d',
          'Left': 'left, l',
          'Right': 'right, r',
          'A': 'a, golpe',
          'B': 'b',
          'Select': 'select, sel',
          'Start': 'start, st',
          'Wait': 'wait, w, espera'
        },
        snes: {
          'Up': 'up, u',
          'Down': 'down, d',
          'Left': 'left, l',
          'Right': 'right, r',
          'A': 'a',
          'B': 'b',
          'X': 'x',
          'Y': 'y',
          'L': 'l',
          'R': 'r',
          'Select': 'select, sel',
          'Start': 'start, st',
          'Wait': 'wait, w'
        },
        gba: {
          'Up': 'up, u',
          'Down': 'down, d',
          'Left': 'left, l',
          'Right': 'right, r',
          'A': 'a',
          'B': 'b',
          'L': 'l',
          'R': 'r',
          'Select': 'select, sel',
          'Start': 'start, st',
          'Wait': 'wait, w'
        },
        genesis: {
          'Up': 'up, u',
          'Down': 'down, d',
          'Left': 'left, l',
          'Right': 'right, r',
          'A': 'a',
          'B': 'b',
          'C': 'c',
          'X': 'x',
          'Y': 'y',
          'Z': 'z',
          'Start': 'start, st',
          'Mode': 'mode, md',
          'Wait': 'wait, w'
        },
        n64: {
          'Up': 'up, u',
          'Down': 'down, d',
          'Left': 'left, l',
          'Right': 'right, r',
          'A': 'a',
          'B': 'b',
          'L': 'l',
          'R': 'r',
          'Z': 'z',
          'C-Up': 'cup, cu',
          'C-Down': 'cdown, cd',
          'C-Left': 'cleft, cl',
          'C-Right': 'cright, cr',
          'Start': 'start, st',
          'Wait': 'wait, w'
        }
      }
    };
    const updateResult = await makeRequest('/api/config', 'POST', newConfig);
    if (!updateResult.success || updateResult.config.channelName !== 'test_streamer' || updateResult.config.buttonPressesCap !== 5) {
      throw new Error('Failed to update config settings!');
    }
    console.log('✔ Configuration updated and dynamic mappings built successfully.');

    // 4. Test Chat Command Parsing & Queue FIFO with new features
    console.log('\n[TEST 4] Simulating Twitch Chat inputs with dynamic mappings, multipliers, waits, and cap...');
    
    // Inject mock messages
    const chatMsg1 = { user: 'RieLoveChan', message: 'arriba+golpe' }; // Custom dynamic combination -> resolving to Up+A
    const chatMsg2 = { user: 'AlexSpeedrun', message: 'b*3' };          // Command Multiplier -> enqueues 3 B inputs
    const chatMsg3 = { user: 'CasualChatter', message: 'espera' };      // Wait command -> enqueues 1 Wait
    const chatMsg4 = { user: 'Spammer', message: 'u*10' };              // Spam exploit -> enqueues 5 Up inputs (capped at buttonPressesCap=5)

    console.log(`- Injecting chat message from @${chatMsg1.user}: "${chatMsg1.message}" (Custom Dynamic Combo)`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg1);
    
    console.log(`- Injecting chat message from @${chatMsg2.user}: "${chatMsg2.message}" (Multiplier *3)`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg2);

    console.log(`- Injecting chat message from @${chatMsg3.user}: "${chatMsg3.message}" (Wait Command)`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg3);

    console.log(`- Injecting chat message from @${chatMsg4.user}: "${chatMsg4.message}" (Spam Multiplier *10 capped at 5)`);
    await makeRequest('/api/mock_chat', 'POST', chatMsg4);

    // Get Status to verify queue size (1 Up+A + 3 B + 1 Wait + 5 Up = 10)
    const status = await makeRequest('/api/status');
    console.log(`✔ Verification status: Queue size is ${status.queueSize} items (Expected: 10)`);
    if (status.queueSize !== 10) {
      throw new Error(`Queue size mismatch! Got ${status.queueSize}, expected 10.`);
    }

    // 5. Test Poll API Consumption
    console.log('\n[TEST 5] Testing /api/poll inputs consumer (BizHawk simulator) to verify all properties...');
    
    // Poll first input (arriba+golpe -> Up+A)
    const poll1 = await makeRequest('/api/poll');
    console.log(`✔ Poll 1 returned: [ ${poll1.commandText} ] by @${poll1.user}`);
    if (poll1.user !== 'RieLoveChan' || !poll1.buttons['Up'] || !poll1.buttons['A']) {
      throw new Error('Poll 1 dynamic combo parsing incorrect!');
    }

    // Poll next three inputs (b*3 -> B, B, B)
    const poll2 = await makeRequest('/api/poll');
    const poll3 = await makeRequest('/api/poll');
    const poll4 = await makeRequest('/api/poll');
    console.log(`✔ Poll 2 returned: [ ${poll2.commandText} ] by @${poll2.user}`);
    console.log(`✔ Poll 3 returned: [ ${poll3.commandText} ] by @${poll3.user}`);
    console.log(`✔ Poll 4 returned: [ ${poll4.commandText} ] by @${poll4.user}`);
    if (poll2.commandText !== 'B' || poll3.commandText !== 'B' || poll4.commandText !== 'B') {
      throw new Error('Poll multiplier queue parsing incorrect!');
    }

    // Poll next input (espera -> Wait command, isWait = true, empty buttons)
    const poll5 = await makeRequest('/api/poll');
    console.log(`✔ Poll 5 returned: [ ${poll5.commandText} ] by @${poll5.user} (isWait: ${poll5.isWait}, buttons: ${JSON.stringify(poll5.buttons)})`);
    if (poll5.commandText !== 'Wait' || !poll5.isWait || Object.keys(poll5.buttons).length !== 0) {
      throw new Error('Poll Wait command parsing incorrect!');
    }

    // Poll next inputs (u*10 -> capped at 5 Up presses)
    const poll6 = await makeRequest('/api/poll');
    console.log(`✔ Poll 6 returned: [ ${poll6.commandText} ] (First of capped sequence)`);
    if (poll6.commandText !== 'Up') {
      throw new Error('Poll capped sequence parsing incorrect!');
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

    // Poll after resume (should return next item in sequence: 'Up')
    const pollResume = await makeRequest('/api/poll');
    console.log(`✔ Polling after resume returned: [ ${pollResume.commandText} ] (Expected 'Up')`);
    if (pollResume.commandText !== 'Up') {
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

    // 8. Test SNES, GBA, Genesis, and N64 dynamic mapping parsing
    console.log('\n[TEST 8] Testing unique input parsing for SNES, GBA, Genesis, and N64...');
    
    // Switch to SNES and test X, Y, L, R buttons
    console.log('- Switching console to SNES...');
    await makeRequest('/api/admin', 'POST', { command: 'console snes' });
    
    console.log('- Injecting SNES chat message: "x+y"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'SnesPlayer', message: 'x+y' });
    
    console.log('- Injecting SNES chat message: "l*2"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'SnesPlayer', message: 'l*2' });
    
    // Switch to GBA and test L, R shoulder buttons
    console.log('- Switching console to GBA...');
    await makeRequest('/api/admin', 'POST', { command: 'console gba' });
    
    console.log('- Injecting GBA chat message: "r"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'GbaPlayer', message: 'r' });
    
    // Switch to Genesis and test C, Z, Mode buttons
    console.log('- Switching console to Genesis...');
    await makeRequest('/api/admin', 'POST', { command: 'console genesis' });
    
    console.log('- Injecting Genesis chat message: "c+z"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'SegaPlayer', message: 'c+z' });
    
    console.log('- Injecting Genesis chat message: "mode"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'SegaPlayer', message: 'mode' });
    
    // Switch to N64 and test C-Up, Z, Dpad Up buttons
    console.log('- Switching console to N64...');
    await makeRequest('/api/admin', 'POST', { command: 'console n64' });
    
    console.log('- Injecting N64 chat message: "cup+z"');
    await makeRequest('/api/mock_chat', 'POST', { user: 'N64Player', message: 'cup+z' });
    
    console.log('- Polling queue to verify SNES/GBA/Genesis/N64 button outputs...');
    
    const p1 = await makeRequest('/api/poll');
    console.log(`  Polled 1 (SNES X+Y) -> user: ${p1.user}, buttons: ${JSON.stringify(p1.buttons)}`);
    if (!p1.buttons['X'] || !p1.buttons['Y']) throw new Error('SNES combo parsing failed!');
    
    const p2 = await makeRequest('/api/poll');
    const p3 = await makeRequest('/api/poll');
    console.log(`  Polled 2 (SNES L) -> buttons: ${JSON.stringify(p2.buttons)}`);
    console.log(`  Polled 3 (SNES L) -> buttons: ${JSON.stringify(p3.buttons)}`);
    if (!p2.buttons['L'] || !p3.buttons['L']) throw new Error('SNES multiplier parsing failed!');
    
    const p4 = await makeRequest('/api/poll');
    console.log(`  Polled 4 (GBA R) -> user: ${p4.user}, buttons: ${JSON.stringify(p4.buttons)}`);
    if (!p4.buttons['R']) throw new Error('GBA parsing failed!');
    
    const p5 = await makeRequest('/api/poll');
    console.log(`  Polled 5 (Genesis C+Z) -> user: ${p5.user}, buttons: ${JSON.stringify(p5.buttons)}`);
    if (!p5.buttons['C'] || !p5.buttons['Z']) throw new Error('Genesis combo parsing failed!');
    
    const p6 = await makeRequest('/api/poll');
    console.log(`  Polled 6 (Genesis Mode) -> buttons: ${JSON.stringify(p6.buttons)}`);
    if (!p6.buttons['Mode']) throw new Error('Genesis Mode parsing failed!');
    
    const p7 = await makeRequest('/api/poll');
    console.log(`  Polled 7 (N64 C-Up+Z) -> user: ${p7.user}, buttons: ${JSON.stringify(p7.buttons)}`);
    if (!p7.buttons['C-Up'] || !p7.buttons['Z']) throw new Error('N64 C-Up+Z parsing failed!');
    
    console.log('✔ All new console systems parsed, polled, and verified successfully!');

    // 9. Test Auto-SaveState features
    console.log('\n[TEST 9] Testing Auto-SaveState configurations & poll/status updates...');
    
    // Enable Auto-SaveState config
    const autoSaveConfig = {
      ...newConfig,
      autoSaveStateEnabled: true,
      autoSaveStateInterval: 1,
      autoSaveStateUnit: 'minutes',
      autoSaveStateSuffix: 'test_fallback'
    };
    console.log('- Enabling Auto-SaveState with interval 1 minute and suffix "test_fallback"...');
    const autoSaveRes = await makeRequest('/api/config', 'POST', autoSaveConfig);
    if (!autoSaveRes.success || !autoSaveRes.config.autoSaveStateEnabled || autoSaveRes.config.autoSaveStateSuffix !== 'test_fallback') {
      throw new Error('Auto-SaveState configurations failed to save!');
    }
    
    // Poll with ROM name parameter and check status API
    console.log('- Polling /api/poll with game name "Super_Mario_Land"...');
    await makeRequest('/api/poll?game=Super_Mario_Land');
    
    const statusWithRom = await makeRequest('/api/status');
    console.log(`- Status gameName: "${statusWithRom.gameName}", romNameAvailable: ${statusWithRom.romNameAvailable}`);
    if (statusWithRom.gameName !== 'Super_Mario_Land' || !statusWithRom.romNameAvailable) {
      throw new Error('ROM/Game name was not tracked successfully on the server!');
    }
    
    // Test dynamic status update on empty query parameters
    console.log('- Polling /api/poll without game parameter...');
    await makeRequest('/api/poll');
    
    const statusWithoutRom = await makeRequest('/api/status');
    console.log(`- Status gameName: "${statusWithoutRom.gameName}", romNameAvailable: ${statusWithoutRom.romNameAvailable}`);
    if (statusWithoutRom.gameName !== null || statusWithoutRom.romNameAvailable) {
      throw new Error('Server failed to reset ROM name when polling parameter is empty!');
    }
    
    console.log('✔ Auto-SaveState API and status updates verified successfully!');

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
