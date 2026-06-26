const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const util = require('util');

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Generate log filename in YYYYMMDD_HHMM_N.log format
function getLogFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}_${hh}${min}`;
  
  let n = 1;
  while (true) {
    const filename = `${dateStr}_${n}.log`;
    const filepath = path.join(LOGS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return filepath;
    }
    n++;
  }
}

const logFilePath = getLogFileName();
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Override console methods to only print and log warnings/errors
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function() {};
console.info = function() {};
console.debug = function() {};

console.warn = function(...args) {
  const formatted = util.format(...args);
  originalWarn.call(console, formatted);
  logStream.write(`[WARNING] [${new Date().toISOString()}] ${formatted}\n`);
};

console.error = function(...args) {
  const formatted = util.format(...args);
  originalError.call(console, formatted);
  logStream.write(`[ERROR] [${new Date().toISOString()}] ${formatted}\n`);
};

// Global Unhandled Process Protection
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection caught globally:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception caught globally:', err);
});

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PORT = process.env.PORT || 8080;

// Default configuration
const DEFAULT_CONFIG = {
  channelName: "",
  botUsername: "",
  twitchOAuthToken: "",
  adminUsers: [],
  bannedUsers: [],
  silenceBannedFeedback: false,
  adminPrefix: "!",
  queueMode: "anarchy", // anarchy, democracy
  holdFrames: 8,
  releaseFrames: 4,
  userCooldownSeconds: 2,
  democracyVoteSeconds: 15,
  sendChatFeedback: true,
  activeConsole: "nes", // nes, gb
  forbiddenFeedbackTemplate: "@{username}, the combination \"{command}\" is blocked on {game} to prevent game resets!",
  connectFeedbackTemplate: "Twitch Plays Companion is ONLINE! Commands are active!",
  forbiddenCooldownSeconds: 15,
  forbiddenBanEnabled: true,
  forbiddenBanThreshold: 3,
  forbiddenBanWindowSeconds: 60,
  forbiddenBanDurationSeconds: 300,
  forbiddenBanFeedbackTemplate: "@{username} has been temporarily banned from playing for {duration} seconds for repeatedly entering forbidden buttons!",
  forbiddenCombinations: {
    nes: [["Select", "Start"]],
    gb: [["Select", "Start"]],
    snes: [["Select", "Start"]],
    gba: [["Select", "Start"]],
    genesis: [],
    n64: []
  },
  inputPrefix: "",
  inputSuffix: "",
  partialPrefixMatch: false,
  buttonPressesCap: 0,
  autoSaveStateEnabled: false,
  autoSaveStateInterval: 36000,
  autoSaveStateSuffix: "",
  autoClearConsoleEnabled: true,
  autoClearConsoleInterval: 15,
  autoPauseEnabled: false,
  autoPauseSeconds: 30,
  buttonMap: {
    nes: {
      'Up': 'up, u',
      'Down': 'down, d',
      'Left': 'left, l',
      'Right': 'right, r',
      'A': 'a',
      'B': 'b',
      'Select': 'select, sel',
      'Start': 'start, st',
      'Wait': 'wait, w'
    },
    gb: {
      'Up': 'up, u',
      'Down': 'down, d',
      'Left': 'left, l',
      'Right': 'right, r',
      'A': 'a',
      'B': 'b',
      'Select': 'select, sel',
      'Start': 'start, st',
      'Wait': 'wait, w'
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

// Global state
let config = { ...DEFAULT_CONFIG };
let activeButtonMap = {};
let activeWaitCommands = new Set();
let bizhawkGameName = null;
let autoSaveStateTimer = null;
let pendingSaveState = false;
let nextSaveStatePath = null;
let lastSavedFrame = null;
let autoClearConsoleTimer = null;
let pendingClearConsole = false;

function rebuildActiveButtonMap() {
  activeButtonMap = {};
  activeWaitCommands = new Set();
  
  const system = config.activeConsole || 'nes';
  const sysMap = config.buttonMap && config.buttonMap[system] ? config.buttonMap[system] : DEFAULT_CONFIG.buttonMap[system];
  
  for (const [physicalBtn, cmdString] of Object.entries(sysMap)) {
    if (!cmdString) continue;
    const triggers = cmdString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    triggers.forEach(trigger => {
      if (physicalBtn === 'Wait') {
        activeWaitCommands.add(trigger);
      } else {
        activeButtonMap[trigger] = physicalBtn;
      }
    });
  }
  
  console.log(`Rebuilt button mappings for console: ${system}`, {
    buttons: activeButtonMap,
    waits: Array.from(activeWaitCommands)
  });
}

let twitchClient = null;
let isPaused = false;
let inputQueue = []; // For anarchy mode
let democracyQueue = []; // For democracy mode sequences
let democracyVotes = {}; // command -> count for democracy
let democracyTimer = null;
let lastDemocracyWinner = null;
let democracyTimeRemaining = 0;
let userCooldowns = new Map(); // username -> timestamp
let stats = {
  totalInputs: 0,
  buttonsPressed: {},
  topChatters: {},
  inputRate: 0, // inputs per minute
  inputsThisMinute: 0
};
let bizhawkLastPoll = 0; // Timestamp

// Auto-SaveState Scheduler and Trigger Functions
function setupAutoSaveStateTimer() {
  if (autoSaveStateTimer) {
    clearInterval(autoSaveStateTimer);
    autoSaveStateTimer = null;
  }
  lastSavedFrame = null;
}

function triggerAutoSaveState() {
  const now = new Date();
  
  // Format YYYYMMDD_HHMMSS
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;

  // Determine game name or suffix
  let gameOrSuffix = 'unknown';
  if (bizhawkGameName && bizhawkGameName.trim()) {
    // Sanitize game name to be safe for filenames
    gameOrSuffix = bizhawkGameName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  } else if (config.autoSaveStateSuffix && config.autoSaveStateSuffix.trim()) {
    gameOrSuffix = config.autoSaveStateSuffix.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  }

  const filename = `${timestamp}_${gameOrSuffix}.State`;
  const saveStatesDir = path.join(__dirname, 'savestates');
  
  try {
    if (!fs.existsSync(saveStatesDir)) {
      fs.mkdirSync(saveStatesDir, { recursive: true });
    }
    
    nextSaveStatePath = path.join(saveStatesDir, filename);
    pendingSaveState = true;
    console.log(`[SCHEDULED STATE] Auto-SaveState triggered! Next BizHawk poll will save to: ${nextSaveStatePath}`);
  } catch (err) {
    console.error('Failed to create savestates directory:', err);
  }
}

// Auto-Clear Console Scheduler and Trigger Functions
function setupAutoClearConsoleTimer() {
  if (autoClearConsoleTimer) {
    clearInterval(autoClearConsoleTimer);
    autoClearConsoleTimer = null;
  }

  if (!config.autoClearConsoleEnabled) {
    console.log('Auto-Clear Console is currently disabled.');
    return;
  }

  const intervalVal = parseInt(config.autoClearConsoleInterval, 10);
  if (isNaN(intervalVal) || intervalVal <= 0) {
    console.warn(`Auto-Clear Console skipped: invalid interval "${config.autoClearConsoleInterval}"`);
    return;
  }

  const ms = intervalVal * 60 * 1000;

  console.log(`Setting up Auto-Clear Console timer for every ${intervalVal} minutes (${ms}ms)`);

  autoClearConsoleTimer = setInterval(() => {
    if (isPaused) {
      console.log('Auto-Clear Console skipped because companion emulation controls are paused.');
      return;
    }
    triggerAutoClearConsole();
  }, ms);
}

function triggerAutoClearConsole() {
  pendingClearConsole = true;
  console.log(`[SCHEDULED CLEAR] Auto-Clear Console triggered! Next BizHawk poll will clear the console.`);
}

// Load Configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      config = { ...DEFAULT_CONFIG, ...parsed };
      // Ensure buttonMap is deep merged correctly
      if (parsed.buttonMap) {
        config.buttonMap = {
          nes: { ...DEFAULT_CONFIG.buttonMap.nes, ...parsed.buttonMap.nes },
          gb: { ...DEFAULT_CONFIG.buttonMap.gb, ...parsed.buttonMap.gb },
          snes: { ...DEFAULT_CONFIG.buttonMap.snes, ...parsed.buttonMap.snes },
          gba: { ...DEFAULT_CONFIG.buttonMap.gba, ...parsed.buttonMap.gba },
          genesis: { ...DEFAULT_CONFIG.buttonMap.genesis, ...parsed.buttonMap.genesis },
          n64: { ...DEFAULT_CONFIG.buttonMap.n64, ...parsed.buttonMap.n64 }
        };
      }
      console.log('Configuration loaded from disk.');
    } else {
      saveConfig(DEFAULT_CONFIG);
    }
    rebuildActiveButtonMap();
    setupAutoSaveStateTimer();
    setupAutoClearConsoleTimer();
  } catch (err) {
    console.error('Error loading config, using defaults:', err);
    config = { ...DEFAULT_CONFIG };
    rebuildActiveButtonMap();
    setupAutoSaveStateTimer();
    setupAutoClearConsoleTimer();
  }
}

// Save Configuration
function saveConfig(newConfig) {
  try {
    const mergedButtonMap = newConfig.buttonMap ? {
      nes: { ...(config.buttonMap ? config.buttonMap.nes : DEFAULT_CONFIG.buttonMap.nes), ...newConfig.buttonMap.nes },
      gb: { ...(config.buttonMap ? config.buttonMap.gb : DEFAULT_CONFIG.buttonMap.gb), ...newConfig.buttonMap.gb },
      snes: { ...(config.buttonMap ? config.buttonMap.snes : DEFAULT_CONFIG.buttonMap.snes), ...newConfig.buttonMap.snes },
      gba: { ...(config.buttonMap ? config.buttonMap.gba : DEFAULT_CONFIG.buttonMap.gba), ...newConfig.buttonMap.gba },
      genesis: { ...(config.buttonMap ? config.buttonMap.genesis : DEFAULT_CONFIG.buttonMap.genesis), ...newConfig.buttonMap.genesis },
      n64: { ...(config.buttonMap ? config.buttonMap.n64 : DEFAULT_CONFIG.buttonMap.n64), ...newConfig.buttonMap.n64 }
    } : (config.buttonMap || DEFAULT_CONFIG.buttonMap);

    const mergedForbiddenCombinations = newConfig.forbiddenCombinations ? {
      nes: newConfig.forbiddenCombinations.nes || (config.forbiddenCombinations ? config.forbiddenCombinations.nes : DEFAULT_CONFIG.forbiddenCombinations.nes),
      gb: newConfig.forbiddenCombinations.gb || (config.forbiddenCombinations ? config.forbiddenCombinations.gb : DEFAULT_CONFIG.forbiddenCombinations.gb),
      snes: newConfig.forbiddenCombinations.snes || (config.forbiddenCombinations ? config.forbiddenCombinations.snes : DEFAULT_CONFIG.forbiddenCombinations.snes),
      gba: newConfig.forbiddenCombinations.gba || (config.forbiddenCombinations ? config.forbiddenCombinations.gba : DEFAULT_CONFIG.forbiddenCombinations.gba),
      genesis: newConfig.forbiddenCombinations.genesis || (config.forbiddenCombinations ? config.forbiddenCombinations.genesis : DEFAULT_CONFIG.forbiddenCombinations.genesis),
      n64: newConfig.forbiddenCombinations.n64 || (config.forbiddenCombinations ? config.forbiddenCombinations.n64 : DEFAULT_CONFIG.forbiddenCombinations.n64)
    } : (config.forbiddenCombinations || DEFAULT_CONFIG.forbiddenCombinations);

    config = { ...config, ...newConfig, buttonMap: mergedButtonMap, forbiddenCombinations: mergedForbiddenCombinations };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved to disk.');
    rebuildActiveButtonMap();
    setupAutoSaveStateTimer();
    setupAutoClearConsoleTimer();
    broadcast('config_updated', config);
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}


// Express & WebSocket Server Setup
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Telemetry Broadcast
function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebClient connected.');
  // Send current state instantly
  ws.send(JSON.stringify({ type: 'config_updated', data: config }));
  ws.send(JSON.stringify({ type: 'queue_updated', data: getQueueState() }));
  ws.send(JSON.stringify({ type: 'status_updated', data: getServerStatus() }));
  ws.send(JSON.stringify({ type: 'stats_updated', data: stats }));
});

// Calculate Input Rates
setInterval(() => {
  stats.inputRate = stats.inputsThisMinute;
  stats.inputsThisMinute = 0;
  broadcast('stats_updated', stats);
}, 60000);

function registerStat(username, command) {
  stats.totalInputs += 1;
  stats.inputsThisMinute += 1;
  
  // Track button frequency
  if (command) {
    const parts = command.toLowerCase().split('+');
    parts.forEach(btn => {
      stats.buttonsPressed[btn] = (stats.buttonsPressed[btn] || 0) + 1;
    });
  }

  // Track top chatters
  stats.topChatters[username] = (stats.topChatters[username] || 0) + 1;
  broadcast('stats_updated', stats);
}

// Twitch Plays Command Parser
function parseCommandText(text) {
  const rawText = text.trim().toLowerCase();
  
  // 1. Check if it's a Wait command
  if (activeWaitCommands.has(rawText)) {
    return {
      buttons: {},
      isWait: true,
      holdFrames: config.holdFrames,
      releaseFrames: config.releaseFrames,
      rawCommand: 'Wait'
    };
  }

  // 2. Check for holds, e.g., "hold a 30" or "a 30"
  let holdMatch = rawText.match(/^(?:hold\s+)?([a-z0-9_]+)\s+(\d+)$/i);
  if (holdMatch) {
    const trigger = holdMatch[1].toLowerCase();
    const frames = Math.min(120, Math.max(1, parseInt(holdMatch[2], 10)));
    
    if (activeWaitCommands.has(trigger)) {
      return {
        buttons: {},
        isWait: true,
        holdFrames: frames,
        releaseFrames: config.releaseFrames,
        rawCommand: `Wait (${frames}f)`
      };
    }
    
    const mappedBtn = activeButtonMap[trigger];
    if (mappedBtn) {
      const buttons = {};
      buttons[mappedBtn] = true;
      return {
        buttons,
        holdFrames: frames,
        releaseFrames: config.releaseFrames,
        rawCommand: `${mappedBtn} (${frames}f)`
      };
    }
  }

  // 3. Check for combinations, e.g., "up+a", "down+b"
  if (rawText.includes('+')) {
    const parts = rawText.split('+');
    const buttons = {};
    const validMapped = [];
    
    for (let part of parts) {
      const trigger = part.trim().toLowerCase();
      const mapped = activeButtonMap[trigger];
      if (mapped) {
        buttons[mapped] = true;
        validMapped.push(mapped);
      }
    }
    
    if (validMapped.length > 0) {
      return {
        buttons,
        holdFrames: config.holdFrames,
        releaseFrames: config.releaseFrames,
        rawCommand: validMapped.join('+')
      };
    }
  }

  // 4. Single button checks
  const mappedBtn = activeButtonMap[rawText];
  if (mappedBtn) {
    const buttons = {};
    buttons[mappedBtn] = true;
    return {
      buttons,
      holdFrames: config.holdFrames,
      releaseFrames: config.releaseFrames,
      rawCommand: mappedBtn
    };
  }

  return null;
}


// Queue State Builder
function getQueueState() {
  if (config.queueMode === 'democracy') {
    return {
      mode: 'democracy',
      votes: democracyVotes,
      timeRemaining: democracyTimeRemaining,
      lastWinner: lastDemocracyWinner
    };
  } else {
    return {
      mode: 'anarchy',
      queue: inputQueue.map(item => ({
        user: item.user,
        command: item.rawCommand
      }))
    };
  }
}

// Server Status Builder
function getServerStatus() {
  return {
    twitchConnected: twitchClient ? twitchClient.readyState() === 'OPEN' : false,
    bizhawkConnected: (Date.now() - bizhawkLastPoll) < 5000,
    isPaused,
    romNameAvailable: !!bizhawkGameName,
    gameName: bizhawkGameName
  };
}

// Democracy Timing Loop
function startDemocracyLoop() {
  if (democracyTimer) clearInterval(democracyTimer);
  democracyTimeRemaining = config.democracyVoteSeconds;
  
  democracyTimer = setInterval(() => {
    if (isPaused) return;
    
    democracyTimeRemaining -= 1;
    if (democracyTimeRemaining <= 0) {
      // Tally votes
      let winner = null;
      let maxVotes = 0;
      
      for (const [cmd, count] of Object.entries(democracyVotes)) {
        if (count > maxVotes) {
          maxVotes = count;
          winner = cmd;
        }
      }
      
      if (winner) {
        // Clear old democracy queue
        democracyQueue = [];
        
        // Parse the winner into sequence of inputs
        const seqParts = winner.split(/\s+/).filter(Boolean);
        const parsedSequence = [];
        let totalPresses = 0;
        const cap = config.buttonPressesCap || 0;

        for (const part of seqParts) {
          if (!part) continue;
          
          const multMatch = part.match(/^(.+)\*(\d+)$/);
          let baseCommand = part;
          let multiplier = 1;
          if (multMatch) {
            baseCommand = multMatch[1].trim();
            multiplier = Math.max(1, parseInt(multMatch[2], 10));
          }
          
          const parsed = parseCommandText(baseCommand);
          if (parsed) {
            if (isForbiddenCombination(parsed.buttons, config.activeConsole)) {
              console.warn(`[DEMOCRACY FILTER] Blocked forbidden combination: ${parsed.rawCommand} from winning vote: "${winner}"`);
              continue;
            }
            for (let i = 0; i < multiplier; i++) {
              if (cap > 0 && totalPresses >= cap) {
                break;
              }
              parsedSequence.push(parsed);
              totalPresses++;
            }
          }
          if (cap > 0 && totalPresses >= cap) {
            break;
          }
        }

        if (parsedSequence.length > 0) {
          // Queue all items in sequence
          parsedSequence.forEach(parsed => {
            democracyQueue.push({
              ...parsed,
              user: 'democracy',
              commandText: parsed.rawCommand,
              votes: maxVotes
            });
          });

          lastDemocracyWinner = {
            rawCommand: winner,
            votes: maxVotes
          };
          
          console.log(`Democracy winner: ${winner} with ${maxVotes} votes (parsed ${parsedSequence.length} inputs).`);
          sendFeedbackToTwitch(`Democracy Input Selected: [ ${winner} ] with ${maxVotes} votes!`);
        } else {
          lastDemocracyWinner = null;
        }
      } else {
        lastDemocracyWinner = null;
      }
      
      // Reset votes
      democracyVotes = {};
      democracyTimeRemaining = config.democracyVoteSeconds;
    }
    
    broadcast('queue_updated', getQueueState());
  }, 1000);
}

function stopDemocracyLoop() {
  if (democracyTimer) {
    clearInterval(democracyTimer);
    democracyTimer = null;
  }
  democracyVotes = {};
  democracyQueue = [];
  lastDemocracyWinner = null;
}

// Switch Mode
function setQueueMode(mode) {
  if (mode !== 'anarchy' && mode !== 'democracy') return false;
  
  config.queueMode = mode;
  saveConfig(config);
  
  if (mode === 'democracy') {
    inputQueue = [];
    democracyQueue = [];
    startDemocracyLoop();
  } else {
    stopDemocracyLoop();
    democracyQueue = [];
  }
  
  broadcast('queue_updated', getQueueState());
  return true;
}


// Twitch Feedback helper
function sendFeedbackToTwitch(message) {
  if (!config.sendChatFeedback || !twitchClient || twitchClient.readyState() !== 'OPEN') return;
  if (!config.twitchOAuthToken || !config.botUsername) return; // Silent if no write creds

  twitchClient.say(config.channelName, message)
    .catch(err => console.error('Error sending chat feedback:', err));
}

// Administrative Command Processor
function processAdminCommand(username, message) {
  const prefix = config.adminPrefix || '!';
  if (!message.startsWith(prefix)) return false;

  const parts = message.slice(prefix.length).trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  console.log(`Admin Command from ${username}: ${cmd}`, args);

  switch (cmd) {
    case 'pause':
      isPaused = true;
      broadcast('status_updated', getServerStatus());
      sendFeedbackToTwitch(`Emulation controls PAUSED by admin @${username}.`);
      return true;
      
    case 'resume':
      isPaused = false;
      broadcast('status_updated', getServerStatus());
      sendFeedbackToTwitch(`Emulation controls RESUMED by admin @${username}.`);
      return true;
      
    case 'clear':
      inputQueue = [];
      democracyQueue = [];
      democracyVotes = {};
      lastDemocracyWinner = null;
      broadcast('queue_updated', getQueueState());
      sendFeedbackToTwitch(`Input queue and votes CLEARED by admin @${username}.`);
      return true;
      
    case 'mode':
      if (args[0]) {
        const mode = args[0].toLowerCase();
        if (setQueueMode(mode)) {
          sendFeedbackToTwitch(`Queue mode changed to [ ${mode.toUpperCase()} ] by admin @${username}.`);
        } else {
          sendFeedbackToTwitch(`Invalid mode: ${args[0]}. Use 'anarchy' or 'democracy'.`);
        }
      }
      return true;
      
    case 'cooldown':
      if (args[0] && !isNaN(args[0])) {
        config.userCooldownSeconds = Math.max(0, parseInt(args[0], 10));
        saveConfig(config);
        sendFeedbackToTwitch(`User cooldown updated to ${config.userCooldownSeconds}s by admin @${username}.`);
      }
      return true;
      
    case 'hold':
      if (args[0] && !isNaN(args[0])) {
        config.holdFrames = Math.max(1, Math.min(120, parseInt(args[0], 10)));
        saveConfig(config);
        sendFeedbackToTwitch(`Default hold duration updated to ${config.holdFrames} frames by admin @${username}.`);
      }
      return true;
      
    case 'release':
      if (args[0] && !isNaN(args[0])) {
        config.releaseFrames = Math.max(1, Math.min(60, parseInt(args[0], 10)));
        saveConfig(config);
        sendFeedbackToTwitch(`Default release duration updated to ${config.releaseFrames} frames by admin @${username}.`);
      }
      return true;

    case 'console':
      if (args[0]) {
        const consoleType = args[0].toLowerCase();
        if (consoleType === 'nes' || consoleType === 'gb' || consoleType === 'snes' || consoleType === 'gba' || consoleType === 'genesis' || consoleType === 'n64') {
          config.activeConsole = consoleType;
          saveConfig(config);
          sendFeedbackToTwitch(`Console system set to [ ${consoleType.toUpperCase()} ] by admin @${username}.`);
        } else {
          sendFeedbackToTwitch(`Invalid console: ${args[0]}. Use 'nes', 'gb', 'snes', 'gba', 'genesis', or 'n64'.`);
        }
      }
      return true;
  }

  return false;
}

// User Authorization checks
function isUserAdmin(tags, username) {
  if (!username) return false;
  const user = username.toLowerCase();
  
  // Broadcaster is always admin
  if (tags && tags.badges && tags.badges.broadcaster === '1') return true;
  if (user === config.channelName.toLowerCase()) return true;

  // Mod check
  if (tags && tags.mod) return true;

  // Custom list check
  const admins = (config.adminUsers || []).map(u => u.toLowerCase());
  return admins.includes(user);
}

function isForbiddenCombination(buttons, system) {
  const forbidden = config.forbiddenCombinations && config.forbiddenCombinations[system];
  if (!forbidden) return false;
  for (const combo of forbidden) {
    if (combo.every(btn => buttons[btn])) {
      return true;
    }
  }
  return false;
}

function formatFeedbackMessage(template, params) {
  let msg = template;
  for (const [key, val] of Object.entries(params)) {
    msg = msg.replace(new RegExp(`{${key}}`, 'gi'), val || '');
  }
  return msg;
}

const forbiddenFeedbackCooldowns = new Map();
const forbiddenAttempts = new Map();
const forbiddenBans = new Map();

// Reusable Twitch Chat Message Handler
function handleChatMessage(username, message, badges = {}, userId = null) {
  const cleanMessage = message.trim();
  const tags = { username, badges, mod: badges.mod === '1' || badges.moderator === '1' };
  const resolvedUserId = userId || username.toLowerCase();

  // Check if the user is manually banned (inputs ignored)
  const manuallyBanned = (config.bannedUsers || []).map(u => u.toLowerCase());
  if (manuallyBanned.includes(username.toLowerCase())) {
    return;
  }

  // 1. Process Admin Commands
  if (isUserAdmin(tags, username)) {
    if (processAdminCommand(username, cleanMessage)) {
      return;
    }
  }

  // Check if the user is currently banned (admins are immune)
  const now = Date.now();
  const banExpiration = forbiddenBans.get(resolvedUserId) || 0;
  if (now < banExpiration) {
    // Banned troll - drop message silently
    return;
  }

  if (isPaused) return;

  // 2. Cooldown Checks for General Inputs
  const lastPress = userCooldowns.get(username) || 0;
  const cdMs = (config.userCooldownSeconds || 0) * 1000;
  
  if (now - lastPress < cdMs) {
    // Under cooldown, drop message silently
    return;
  }

  // 3. Process Prefix & Suffix Constraints
  let commandToParse = cleanMessage;
  const prefix = (config.inputPrefix || "").trim().toLowerCase();
  const suffix = (config.inputSuffix || "").trim().toLowerCase();
  const partialMatch = config.partialPrefixMatch;

  if (prefix) {
    if (partialMatch) {
      // Find prefix anywhere in the message and extract the token immediately following it
      const escapedPrefix = prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`${escapedPrefix}\\s*([^\\s]+)`, 'i');
      const match = cleanMessage.match(regex);
      if (match) {
        commandToParse = match[1];
      } else {
        // Prefix required but missing - treat as normal chat or drop
        return;
      }
    } else {
      // Strict start-of-message match
      if (cleanMessage.toLowerCase().startsWith(prefix)) {
        commandToParse = cleanMessage.slice(prefix.length).trim();
      } else {
        // Prefix required but missing - treat as normal chat or drop
        return;
      }
    }
  }

  if (suffix) {
    if (partialMatch) {
      // Find suffix anywhere in the message and extract the token immediately preceding it
      const escapedSuffix = suffix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`([^\\s]+)\\s*${escapedSuffix}`, 'i');
      const match = commandToParse.match(regex);
      if (match) {
        commandToParse = match[1];
      } else {
        // Suffix required but missing - treat as normal chat or drop
        return;
      }
    } else {
      // Strict end-of-message match
      if (commandToParse.toLowerCase().endsWith(suffix)) {
        commandToParse = commandToParse.slice(0, commandToParse.length - suffix.length).trim();
      } else {
        // Suffix required but missing - treat as normal chat or drop
        return;
      }
    }
  }

  // 4. Parse Chat Inputs
  const seqParts = commandToParse.split(/\s+/).filter(Boolean);
  const parsedSequence = [];
  let totalPresses = 0;
  const cap = config.buttonPressesCap || 0;

  for (const part of seqParts) {
    if (!part) continue;
    
    // Check for multiplier, e.g. "Up*4"
    const multMatch = part.match(/^(.+)\*(\d+)$/);
    let baseCommand = part;
    let multiplier = 1;
    if (multMatch) {
      baseCommand = multMatch[1].trim();
      multiplier = Math.max(1, parseInt(multMatch[2], 10));
    }
    
    const parsed = parseCommandText(baseCommand);
    if (parsed) {
      // Check if this part is a forbidden combination
      if (isForbiddenCombination(parsed.buttons, config.activeConsole)) {
        console.warn(`[INPUT FILTER] Blocked forbidden combination: ${parsed.rawCommand} by @${username} (ROM: ${bizhawkGameName || "Unknown"})`);
        
        // --- Troll Prevention & Banning Logic ---
        if (config.forbiddenBanEnabled && !isUserAdmin(tags, username)) {
          let attempts = forbiddenAttempts.get(resolvedUserId) || [];
          attempts = attempts.filter(t => now - t <= (config.forbiddenBanWindowSeconds || 60) * 1000);
          attempts.push(now);
          forbiddenAttempts.set(resolvedUserId, attempts);

          if (attempts.length >= (config.forbiddenBanThreshold || 3)) {
            // Ban the user
            const durationSec = config.forbiddenBanDurationSeconds || 300;
            const banEnd = now + (durationSec * 1000);
            forbiddenBans.set(resolvedUserId, banEnd);
            console.warn(`[INPUT FILTER] User @${username} (ID: ${resolvedUserId}) banned for ${durationSec} seconds due to repeated forbidden inputs.`);
            
            if (config.sendChatFeedback && !config.silenceBannedFeedback) {
              const template = config.forbiddenBanFeedbackTemplate || "@{username} has been temporarily banned from playing for {duration} seconds for repeatedly entering forbidden buttons!";
              const banMessage = formatFeedbackMessage(template, {
                username: username,
                duration: durationSec,
                game: bizhawkGameName || "Unknown Game",
                time: new Date().toLocaleTimeString()
              });
              sendFeedbackToTwitch(banMessage);
            }
            continue; // Skip command
          }
        }

        // Apply feedback message cooldown
        const lastFeedback = forbiddenFeedbackCooldowns.get(resolvedUserId) || 0;
        const cooldownMs = (config.forbiddenCooldownSeconds || 15) * 1000;

        if (now - lastFeedback >= cooldownMs) {
          forbiddenFeedbackCooldowns.set(resolvedUserId, now);
          if (config.sendChatFeedback) {
            const template = config.forbiddenFeedbackTemplate || "@{username}, the combination \"{command}\" is blocked on {game} to prevent game resets!";
            const feedbackText = formatFeedbackMessage(template, {
              username: username,
              command: parsed.rawCommand,
              game: bizhawkGameName || "Unknown Game",
              time: new Date().toLocaleTimeString()
            });
            sendFeedbackToTwitch(feedbackText);
          }
        }
        continue; // Skip this forbidden part and continue checking subsequent parts
      }

      for (let i = 0; i < multiplier; i++) {
        if (cap > 0 && totalPresses >= cap) {
          break;
        }
        parsedSequence.push(parsed);
        totalPresses++;
      }
    }
    
    if (cap > 0 && totalPresses >= cap) {
      break;
    }
  }

  if (parsedSequence.length > 0) {
    userCooldowns.set(username, now);
    
    if (config.queueMode === 'democracy') {
      const democracyText = parsedSequence.map(p => p.rawCommand).join(' ');
      democracyVotes[democracyText] = (democracyVotes[democracyText] || 0) + 1;
      registerStat(username, democracyText);
      
      broadcast('queue_updated', getQueueState());
      broadcast('chat_message', { user: username, message: cleanMessage, badge: badges, isCommand: true });
    } else {
      parsedSequence.forEach(parsed => {
        inputQueue.push({
          ...parsed,
          user: username,
          commandText: parsed.rawCommand
        });
        registerStat(username, parsed.rawCommand);
      });
      
      broadcast('queue_updated', getQueueState());
      broadcast('chat_message', { user: username, message: cleanMessage, badge: badges, isCommand: true });
    }
  } else {
    // Not a game command or fully filtered, just broadcast as standard chat message to dashboard
    broadcast('chat_message', { user: username, message: cleanMessage, badge: badges, isCommand: false });
  }
}

// Initialize Twitch Client
function initTwitch() {
  if (twitchClient) {
    console.log("Disconnecting existing Twitch client...");
    try {
      twitchClient.disconnect().catch(err => {
        console.error("Error disconnecting old Twitch client (promise):", err);
      });
    } catch (e) {
      console.error("Error disconnecting old Twitch client:", e);
    }
    twitchClient = null;
  }

  if (!config.channelName) {
    console.log("No Twitch channel configured. Waiting for configurations via Dashboard.");
    broadcast('status_updated', getServerStatus());
    return;
  }

  const twitchOpts = {
    options: { debug: false },
    connection: { reconnect: true, secure: true }
  };

  // Check for OAuth
  if (config.botUsername && config.twitchOAuthToken) {
    // Authenticated connection
    let token = config.twitchOAuthToken;
    if (!token.startsWith('oauth:')) {
      token = `oauth:${token}`;
    }
    twitchOpts.identity = {
      username: config.botUsername,
      password: token
    };
    console.log(`Connecting to Twitch as BOT: ${config.botUsername} in channel: ${config.channelName}`);
  } else {
    // Anonymous connection (Read-Only)
    console.log(`Connecting to Twitch ANONYMOUSLY in channel: ${config.channelName}`);
  }

  twitchOpts.channels = [config.channelName];

  try {
    twitchClient = new tmi.client(twitchOpts);
    
    twitchClient.on('message', (channel, tags, message, self) => {
      if (self) return; // Skip bot's own messages
      const username = tags.username || 'anonymous';
      const userId = tags['user-id'] || username.toLowerCase();
      handleChatMessage(username, message, tags.badges || {}, userId);
    });

    twitchClient.on('connected', (addr, port) => {
      console.log(`Connected to Twitch IRC: ${addr}:${port}`);
      broadcast('status_updated', getServerStatus());
      
      const template = config.connectFeedbackTemplate || "Twitch Plays Companion is ONLINE! Commands are active!";
      const feedbackText = formatFeedbackMessage(template, {
        channel: config.channelName,
        game: bizhawkGameName || "Unknown Game",
        time: new Date().toLocaleTimeString()
      });
      sendFeedbackToTwitch(feedbackText);
    });

    twitchClient.on('disconnected', (reason) => {
      console.log(`Disconnected from Twitch: ${reason}`);
      broadcast('status_updated', getServerStatus());
    });

    twitchClient.on('error', (err) => {
      console.error('Twitch Client Core Error:', err);
      broadcast('status_updated', getServerStatus());
    });

    twitchClient.connect().catch(err => {
      console.error('Error connecting to Twitch:', err);
    });

  } catch (err) {
    console.error('Failed to create Twitch client:', err);
  }
}

// Express Routes API

// GET status
app.get('/api/status', (req, res) => {
  res.json({
    ...getServerStatus(),
    config: {
      channelName: config.channelName,
      queueMode: config.queueMode,
      activeConsole: config.activeConsole,
      userCooldownSeconds: config.userCooldownSeconds
    },
    queueSize: config.queueMode === 'democracy' ? Object.keys(democracyVotes).length : inputQueue.length
  });
});

// GET configuration
app.get('/api/config', (req, res) => {
  res.json(config);
});

// POST update configuration
app.post('/api/config', (req, res) => {
  console.log('POST /api/config payload received:', req.body);
  const previousChannel = config.channelName;
  const previousUsername = config.botUsername;
  const previousToken = config.twitchOAuthToken;

  if (saveConfig(req.body)) {
    // If connection credentials changed, trigger Twitch reconnect
    if (config.channelName !== previousChannel ||
        config.botUsername !== previousUsername ||
        config.twitchOAuthToken !== previousToken) {
      console.log('Credentials changed, reconnecting to Twitch...');
      initTwitch();
    }
    
    // If queue mode changed, apply immediately
    if (req.body.queueMode && req.body.queueMode !== config.queueMode) {
      setQueueMode(req.body.queueMode);
    }
    
    res.json({ success: true, config });
  } else {
    res.status(500).json({ success: false, message: 'Failed to save configuration file.' });
  }
});

// POST local admin override
app.post('/api/admin', (req, res) => {
  const { command, user } = req.body;
  
  if (!command) {
    return res.status(400).json({ success: false, message: 'Missing command parameter.' });
  }
  
  console.log(`Local Admin dashboard trigger: ${command}`);
  
  // Format message as if it came from twitch chat to process it through the existing robust command processor
  const prefix = config.adminPrefix || '!';
  const fullCommand = `${prefix}${command}`;
  
  // Process the command
  const handled = processAdminCommand(user || 'dashboard_admin', fullCommand);
  
  if (handled) {
    res.json({ success: true, message: `Command '${command}' executed successfully.` });
  } else {
    res.status(400).json({ success: false, message: `Failed to execute admin command '${command}'.` });
  }
});

// POST mock chat command for simulation & testing
app.post('/api/mock_chat', (req, res) => {
  const { user, message, badges, userId } = req.body;
  
  if (!user || !message) {
    return res.status(400).json({ success: false, message: 'Missing user or message parameter.' });
  }
  
  console.log(`Local Mock Chat injection by @${user}: ${message}`);
  handleChatMessage(user, message, badges || {}, userId || user.toLowerCase());
  
  res.json({ success: true, message: 'Mock chat injected successfully.' });
});

// GET statistics
app.get('/api/stats', (req, res) => {
  res.json(stats);
});

// GET poll for BizHawk Lua
app.get('/api/poll', (req, res) => {
  bizhawkLastPoll = Date.now();
  
  // Track game name from query parameters
  const newGameName = req.query.game || null;
  if (newGameName !== bizhawkGameName) {
    console.log(`BizHawk reported game name change: "${bizhawkGameName}" -> "${newGameName}"`);
    bizhawkGameName = newGameName;
    broadcast('status_updated', getServerStatus());
  }
  
  if (isPaused) {
    return res.json({});
  }

  // Process frame-based savestate
  const currentFrame = parseInt(req.query.frames, 10);
  if (!isNaN(currentFrame)) {
    if (lastSavedFrame === null || currentFrame < lastSavedFrame) {
      lastSavedFrame = currentFrame;
    } else if (config.autoSaveStateEnabled) {
      const intervalVal = parseInt(config.autoSaveStateInterval, 10);
      if (!isNaN(intervalVal) && intervalVal > 0) {
        if (currentFrame - lastSavedFrame >= intervalVal) {
          triggerAutoSaveState();
          lastSavedFrame = currentFrame;
        }
      }
    }
  }

  let responseData = {};

  if (req.query.batch === '1') {
    const limit = parseInt(req.query.limit, 10) || 50;
    const commands = [];
    const activeQueue = config.queueMode === 'democracy' ? democracyQueue : inputQueue;

    while (activeQueue.length > 0 && commands.length < limit) {
      const cmd = activeQueue.shift();
      if (cmd.buttons || cmd.isWait) {
        cmd.releaseFrames = cmd.releaseFrames || config.releaseFrames;
      }
      commands.push(cmd);
      broadcast('input_pressed', { buttons: cmd.buttons, user: cmd.user, command: cmd.rawCommand, isWait: cmd.isWait });
    }

    if (commands.length > 0) {
      broadcast('queue_updated', getQueueState());
    }

    responseData = { commands };
  } else {
    // Legacy single item mode
    const activeQueue = config.queueMode === 'democracy' ? democracyQueue : inputQueue;
    if (activeQueue.length > 0) {
      responseData = { ...activeQueue.shift() };
      if (responseData.buttons || responseData.isWait) {
        responseData.releaseFrames = responseData.releaseFrames || config.releaseFrames;
      }
      broadcast('queue_updated', getQueueState());
      broadcast('input_pressed', { buttons: responseData.buttons, user: responseData.user, command: responseData.rawCommand, isWait: responseData.isWait });
    }
  }

  // Inject saveState details if pending
  if (pendingSaveState && nextSaveStatePath) {
    responseData.saveState = true;
    responseData.saveStatePath = nextSaveStatePath;
    pendingSaveState = false;
    nextSaveStatePath = null;
    console.log(`[POLL COMMAND] Dispatched saveState instruction to BizHawk for path: ${responseData.saveStatePath}`);
  }

  // Inject clearConsole details if pending
  if (pendingClearConsole) {
    responseData.clearConsole = true;
    pendingClearConsole = false;
    console.log(`[POLL COMMAND] Dispatched clearConsole instruction to BizHawk`);
  }

  // Inject autoPause configuration
  responseData.autoPauseEnabled = config.autoPauseEnabled || false;
  responseData.autoPauseSeconds = parseInt(config.autoPauseSeconds, 10) || 0;

  return res.json(responseData);
});

// Start Server
loadConfig();
initTwitch();

server.listen(PORT, () => {
  console.log(`Twitch Plays Server running at http://localhost:${PORT}`);
});
