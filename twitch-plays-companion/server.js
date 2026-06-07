const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');

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
  adminPrefix: "!",
  queueMode: "anarchy", // anarchy, democracy
  holdFrames: 8,
  releaseFrames: 4,
  userCooldownSeconds: 2,
  democracyVoteSeconds: 15,
  sendChatFeedback: true,
  activeConsole: "nes", // nes, gb
  inputPrefix: "",
  inputSuffix: "",
  partialPrefixMatch: false,
  buttonPressesCap: 0,
  autoSaveStateEnabled: false,
  autoSaveStateInterval: 15,
  autoSaveStateUnit: "minutes",
  autoSaveStateSuffix: "",
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

  if (!config.autoSaveStateEnabled) {
    console.log('Auto-SaveState is currently disabled.');
    return;
  }

  const intervalVal = parseInt(config.autoSaveStateInterval, 10);
  if (isNaN(intervalVal) || intervalVal <= 0) {
    console.warn(`Auto-SaveState skipped: invalid interval "${config.autoSaveStateInterval}"`);
    return;
  }

  const multiplier = config.autoSaveStateUnit === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
  const ms = intervalVal * multiplier;

  console.log(`Setting up Auto-SaveState timer for every ${intervalVal} ${config.autoSaveStateUnit} (${ms}ms)`);

  autoSaveStateTimer = setInterval(() => {
    if (isPaused) {
      console.log('Auto-SaveState skipped because companion emulation controls are paused.');
      return;
    }
    triggerAutoSaveState();
  }, ms);
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
  } catch (err) {
    console.error('Error loading config, using defaults:', err);
    config = { ...DEFAULT_CONFIG };
    rebuildActiveButtonMap();
    setupAutoSaveStateTimer();
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

    config = { ...config, ...newConfig, buttonMap: mergedButtonMap };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved to disk.');
    rebuildActiveButtonMap();
    setupAutoSaveStateTimer();
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
              commandText: parsed.rawCommand
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

// Reusable Twitch Chat Message Handler
function handleChatMessage(username, message, badges = {}) {
  const cleanMessage = message.trim();
  const tags = { username, badges, mod: badges.mod === '1' || badges.moderator === '1' };

  // 1. Process Admin Commands
  if (isUserAdmin(tags, username)) {
    if (processAdminCommand(username, cleanMessage)) {
      return;
    }
  }

  if (isPaused) return;

  // 2. Cooldown Checks for General Inputs
  const now = Date.now();
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
      democracyVotes[commandToParse] = (democracyVotes[commandToParse] || 0) + 1;
      registerStat(username, commandToParse);
      
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
    // Not a game command, just broadcast as standard chat message to dashboard
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
      handleChatMessage(username, message, tags.badges || {});
    });

    twitchClient.on('connected', (addr, port) => {
      console.log(`Connected to Twitch IRC: ${addr}:${port}`);
      broadcast('status_updated', getServerStatus());
      sendFeedbackToTwitch(`Twitch Plays Companion is ONLINE! Commands are active!`);
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
  const { user, message, badges } = req.body;
  
  if (!user || !message) {
    return res.status(400).json({ success: false, message: 'Missing user or message parameter.' });
  }
  
  console.log(`Local Mock Chat injection by @${user}: ${message}`);
  handleChatMessage(user, message, badges || {});
  
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

  return res.json(responseData);
});

// Start Server
loadConfig();
initTwitch();

server.listen(PORT, () => {
  console.log(`Twitch Plays Server running at http://localhost:${PORT}`);
});
