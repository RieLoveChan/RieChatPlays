/**
 * Integration Test: Forbidden Button Combinations Verification
 * Stored in _automated_tests as per repository guidelines.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_PATH = path.join(__dirname, '..', 'twitch-plays-companion', 'server.js');
const CONFIG_PATH = path.join(__dirname, '..', 'twitch-plays-companion', 'config.json');
const BASE_URL = 'http://localhost:8085';

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
  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status} on ${method} ${endpoint}`);
  }
  return response.json();
}

async function runTests() {
  console.log('====================================================');
  console.log('  STARTING FORBIDDEN COMBINATIONS INTEGRATION TESTS ');
  console.log('====================================================');

  // Backup original config
  let configBackup = null;
  if (fs.existsSync(CONFIG_PATH)) {
    configBackup = fs.readFileSync(CONFIG_PATH, 'utf8');
  }

  console.log('\n[TEST 1] Starting server process...');
  serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: '8085' },
    stdio: 'pipe'
  });
  
  // Pipe server output to console
  serverProcess.stdout.on('data', (data) => {
    process.stdout.write('[SERVER-OUT] ' + data.toString());
  });
  serverProcess.stderr.on('data', (data) => {
    process.stderr.write('[SERVER-ERR] ' + data.toString());
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\n❌ Server exited prematurely with code ${code}`);
      process.exit(1);
    }
  });

  await sleep(1500);
  console.log('✔ Server started successfully.');

  try {
    // 1. Fetch current config and check defaults
    console.log('\n[TEST 2] Verifying default configuration of forbiddenCombinations...');
    const currentConfig = await makeRequest('/api/config');
    console.log('Current console system:', currentConfig.activeConsole);
    console.log('Default forbidden combinations for gb:', JSON.stringify(currentConfig.forbiddenCombinations && currentConfig.forbiddenCombinations.gb));
    console.log('Default feedback template:', currentConfig.forbiddenFeedbackTemplate);

    if (!currentConfig.forbiddenCombinations || !currentConfig.forbiddenCombinations.gb) {
      throw new Error('Expected forbiddenCombinations.gb to exist in default config');
    }

    const gbForbidden = currentConfig.forbiddenCombinations.gb;
    const hasSelectStart = gbForbidden.some(combo => combo.includes('Select') && combo.includes('Start'));
    if (!hasSelectStart) {
      throw new Error('Expected Select+Start to be blocked on gb by default');
    }
    console.log('✔ Defaults verified successfully.');

    // Configure Twitch feedback to be active for tests
    const setupConfig = {
      ...currentConfig,
      sendChatFeedback: true,
      activeConsole: 'gb',
      inputPrefix: '',
      inputSuffix: '',
      userCooldownSeconds: 0 // Disable cooldowns for rapid testing
    };
    await makeRequest('/api/config', 'POST', setupConfig);

    // 2. Validate standard inputs are queued correctly
    console.log('\n[TEST 3] Injecting standard command: "a" and "up+b"...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'test_user', message: 'a' });
    await makeRequest('/api/mock_chat', 'POST', { user: 'test_user', message: 'up+b' });

    let pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands:', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 2) {
      throw new Error(`Expected 2 queued commands, got: ${pollRes.commands.length}`);
    }
    if (pollRes.commands[0].rawCommand !== 'A' || pollRes.commands[1].rawCommand !== 'Up+B') {
      throw new Error('Standard commands not parsed correctly');
    }
    console.log('✔ Standard commands parsed and queued correctly.');

    // 3. Validate forbidden inputs are filtered out
    console.log('\n[TEST 4] Injecting forbidden combination: "select+start" (should be blocked)...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'test_user', message: 'select+start' });

    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands after forbidden injection:', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 0) {
      throw new Error('Expected 0 commands (forbidden input should be blocked and not queued)');
    }
    console.log('✔ Forbidden combination was correctly blocked.');

    // 4. Validate partial sequence filtering
    console.log('\n[TEST 5] Injecting sequence with forbidden combination: "a select+start b"...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'test_user', message: 'a select+start b' });

    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands after sequence injection:', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 2) {
      throw new Error(`Expected 2 commands (only valid "a" and "b" should pass), got: ${pollRes.commands.length}`);
    }
    if (pollRes.commands[0].rawCommand !== 'A' || pollRes.commands[1].rawCommand !== 'B') {
      throw new Error('Failed to filter out the forbidden combination from the sequence correctly');
    }
    console.log('✔ Sequence correctly queued valid inputs and skipped only the blocked combinations.');

    // 5. Test Democracy Mode filtering
    console.log('\n[TEST 6] Testing Democracy Mode filtering on vote submissions...');
    // Enable democracy mode
    await makeRequest('/api/admin', 'POST', { command: 'mode democracy', user: 'dashboard_admin' });
    
    // Vote for forbidden only
    await makeRequest('/api/mock_chat', 'POST', { user: 'voter1', message: 'select+start' });
    let status = await makeRequest('/api/status');
    console.log('Democracy queue state (forbidden vote):', JSON.stringify(status.queueSize));
    if (status.queueSize !== 0) {
      throw new Error('Forbidden-only vote should have been rejected');
    }

    // Vote for sequence containing forbidden: "left select+start"
    await makeRequest('/api/mock_chat', 'POST', { user: 'voter2', message: 'left select+start' });
    status = await makeRequest('/api/status');
    console.log('Democracy queue state after sequence vote:', JSON.stringify(status.queueSize));
    if (status.queueSize !== 1) {
      throw new Error('Sequence vote containing forbidden should have been registered as 1 unique option');
    }

    // Check what the registered option is (it should have been cleaned to "Left")
    const queueState = await makeRequest('/api/status');
    // Clear democracy mode back to anarchy
    await makeRequest('/api/admin', 'POST', { command: 'mode anarchy', user: 'dashboard_admin' });
    console.log('✔ Democracy mode filtering verified.');

    // 6. Test Bot Feedback Cooldown & Banning Logic
    console.log('\n[TEST 7] Testing Feedback Cooldown and Ban Rules...');
    const banTestConfig = {
      ...setupConfig,
      forbiddenBanEnabled: true,
      forbiddenBanThreshold: 2,
      forbiddenBanWindowSeconds: 10,
      forbiddenBanDurationSeconds: 2,
      forbiddenCooldownSeconds: 5
    };
    await makeRequest('/api/config', 'POST', banTestConfig);

    // Verify Ban Triggering
    console.log('Injecting 1st forbidden input for Troll (should NOT ban yet)...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'Troll', userId: 'troll_123', message: 'select+start' });
    
    // Inject valid 'a' (should be processed)
    await makeRequest('/api/mock_chat', 'POST', { user: 'Troll', userId: 'troll_123', message: 'a' });
    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands (expected 1 for A):', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 1 || pollRes.commands[0].rawCommand !== 'A') {
      throw new Error('Valid inputs should still be processed before ban threshold is reached');
    }

    console.log('Injecting 2nd forbidden input for Troll (should trigger ban)...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'Troll', userId: 'troll_123', message: 'select+start' });

    // Inject valid 'a' while banned (should be dropped silently)
    console.log('Injecting valid command "a" while Troll is banned...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'Troll', userId: 'troll_123', message: 'a' });
    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands (expected 0 while banned):', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 0) {
      throw new Error('Inputs from banned user must be dropped silently');
    }

    // Wait for ban expiration
    console.log('Sleeping 2.5 seconds for ban to expire...');
    await sleep(2500);

    // Inject valid 'a' after ban expiration (should be allowed)
    console.log('Injecting valid command "a" after Troll ban expired...');
    await makeRequest('/api/mock_chat', 'POST', { user: 'Troll', userId: 'troll_123', message: 'a' });
    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands (expected 1 for A):', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 1 || pollRes.commands[0].rawCommand !== 'A') {
      throw new Error('User inputs should be allowed again after ban duration expires');
    }
    console.log('✔ Automated banning and silent input dropping verified.');

    // 7. Verify Nickname Bypass Protection using user-id tracking
    console.log('\n[TEST 8] Testing Nickname change bypass protection using permanent User ID tracking...');
    // Inject 1st attempt under nickname "TrollNameA" but user-id "troll_id_999"
    await makeRequest('/api/mock_chat', 'POST', { user: 'TrollNameA', userId: 'troll_id_999', message: 'select+start' });

    // Inject 2nd attempt under nickname "TrollNameB" but user-id "troll_id_999" (different name, same id!)
    await makeRequest('/api/mock_chat', 'POST', { user: 'TrollNameB', userId: 'troll_id_999', message: 'select+start' });

    // User should now be banned. Injecting a command under nickname "TrollNameC" but same user-id "troll_id_999" should fail.
    await makeRequest('/api/mock_chat', 'POST', { user: 'TrollNameC', userId: 'troll_id_999', message: 'a' });
    pollRes = await makeRequest('/api/poll?batch=1&limit=5');
    console.log('Polled commands under nickname-changed bypass attempt:', JSON.stringify(pollRes.commands));
    if (pollRes.commands.length !== 0) {
      throw new Error('User was able to bypass the ban by changing nickname! User ID tracking failed.');
    }
    console.log('✔ Nickname bypass protection verified successfully.');

    console.log('\n====================================================');
    console.log('   🎉 ALL FORBIDDEN COMBINATIONS TESTS PASSED!      ');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ TEST FAILED:');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      console.log('\nStopping companion server...');
      serverProcess.kill('SIGINT');
      console.log('Server stopped.');
    }

    // Restore original config backup
    if (configBackup) {
      fs.writeFileSync(CONFIG_PATH, configBackup, 'utf8');
      console.log('Config file restored to original state.');
    }
  }
}

runTests();
