/**
 * Integration Test: Auto-Clear Console Configuration and API Verification
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
  console.log('  STARTING AUTO-CLEAR CONSOLE INTEGRATION TESTS     ');
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
    console.log('\n[TEST 2] Verifying default configuration of Auto-Clear Console...');
    const currentConfig = await makeRequest('/api/config');
    console.log('Current config:', JSON.stringify({
      autoClearConsoleEnabled: currentConfig.autoClearConsoleEnabled,
      autoClearConsoleInterval: currentConfig.autoClearConsoleInterval
    }));

    if (currentConfig.autoClearConsoleEnabled !== true) {
      throw new Error(`Expected autoClearConsoleEnabled to default to true, got: ${currentConfig.autoClearConsoleEnabled}`);
    }
    if (currentConfig.autoClearConsoleInterval !== 15) {
      throw new Error(`Expected autoClearConsoleInterval to default to 15, got: ${currentConfig.autoClearConsoleInterval}`);
    }
    console.log('✔ Defaults verified successfully.');

    // 2. Modify config and verify save/load
    console.log('\n[TEST 3] Updating config to test custom interval...');
    const updatedConfigPayload = {
      ...currentConfig,
      autoClearConsoleEnabled: true,
      autoClearConsoleInterval: 30
    };
    const saveResponse = await makeRequest('/api/config', 'POST', updatedConfigPayload);
    if (!saveResponse.success) {
      throw new Error('POST /api/config failed');
    }

    const verificationConfig = await makeRequest('/api/config');
    console.log('Updated config:', JSON.stringify({
      autoClearConsoleEnabled: verificationConfig.autoClearConsoleEnabled,
      autoClearConsoleInterval: verificationConfig.autoClearConsoleInterval
    }));

    if (verificationConfig.autoClearConsoleInterval !== 30) {
      throw new Error(`Expected autoClearConsoleInterval to be 30, got: ${verificationConfig.autoClearConsoleInterval}`);
    }
    console.log('✔ Custom config successfully saved and loaded.');

    // 3. Test toggling off auto-clear
    console.log('\n[TEST 4] Disabling Auto-Clear Console...');
    const disabledConfigPayload = {
      ...verificationConfig,
      autoClearConsoleEnabled: false
    };
    const disableResponse = await makeRequest('/api/config', 'POST', disabledConfigPayload);
    if (!disableResponse.success) {
      throw new Error('POST /api/config failed when disabling');
    }

    const finalConfig = await makeRequest('/api/config');
    console.log('Final config:', JSON.stringify({
      autoClearConsoleEnabled: finalConfig.autoClearConsoleEnabled,
      autoClearConsoleInterval: finalConfig.autoClearConsoleInterval
    }));

    if (finalConfig.autoClearConsoleEnabled !== false) {
      throw new Error(`Expected autoClearConsoleEnabled to be false, got: ${finalConfig.autoClearConsoleEnabled}`);
    }
    console.log('✔ Config successfully disabled.');

    console.log('\n====================================================');
    console.log('   🎉 ALL AUTO-CLEAR INTEGRATION TESTS PASSED!       ');
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
