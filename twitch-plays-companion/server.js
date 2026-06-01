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
  partialPrefixMatch: false
};

// Global state
let config = { ...DEFAULT_CONFIG };
let twitchClient = null;
let isPaused = false;
let inputQueue = []; // For anarchy mode
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

// Load Configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      console.log('Configuration loaded from disk.');
    } else {
      saveConfig(DEFAULT_CONFIG);
    }
  } catch (err) {
    console.error('Error loading config, using defaults:', err);
    config = { ...DEFAULT_CONFIG };
  }
}

// Save Configuration
function saveConfig(newConfig) {
  try {
    config = { ...config, ...newConfig };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved to disk.');
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
const BUTTON_MAP = {
  // standard button mapping
  'a': 'A',
  'b': 'B',
  'up': 'Up',
  'u': 'Up',
  'down': 'Down',
  'd': 'Down',
  'left': 'Left',
  'l': 'Left',
  'right': 'Right',
  'r': 'Right',
  'select': 'Select',
  'sel': 'Select',
  'start': 'Start',
  'st': 'Start'
};

function parseCommandText(text) {
  const rawText = text.trim().toLowerCase();
  
  // Check for holds, e.g., "hold a 30" or "a 30"
  let holdMatch = rawText.match(/^(?:hold\s+)?(a|b|up|down|left|right|select|start|u|d|l|r|sel|st)\s+(\d+)$/i);
  if (holdMatch) {
    const rawBtn = holdMatch[1];
    const frames = Math.min(120, Math.max(1, parseInt(holdMatch[2], 10)));
    const mappedBtn = BUTTON_MAP[rawBtn];
    if (mappedBtn) {
      const buttons = {};
      buttons[mappedBtn] = true;
      return {
        buttons,
        holdFrames: frames,
        rawCommand: `${mappedBtn} (${frames}f)`
      };
    }
  }

  // Check for combinations, e.g., "up+a", "down+b", "left+right+start"
  if (rawText.includes('+')) {
    const parts = rawText.split('+');
    const buttons = {};
    const validMapped = [];
    
    for (let part of parts) {
      const mapped = BUTTON_MAP[part.trim()];
      if (mapped) {
        buttons[mapped] = true;
        validMapped.push(mapped);
      }
    }
    
    if (validMapped.length > 0) {
      return {
        buttons,
        holdFrames: config.holdFrames,
        rawCommand: validMapped.join('+')
      };
    }
  }

  // Single button checks
  const mappedBtn = BUTTON_MAP[rawText];
  if (mappedBtn) {
    const buttons = {};
    buttons[mappedBtn] = true;
    return {
      buttons,
      holdFrames: config.holdFrames,
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
    isPaused
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
        const parsed = parseCommandText(winner);
        if (parsed) {
          // Put the winning command into a temporary slot for BizHawk to fetch next
          lastDemocracyWinner = {
            ...parsed,
            user: 'democracy',
            commandText: parsed.rawCommand,
            votes: maxVotes
          };
          console.log(`Democracy winner: ${winner} with ${maxVotes} votes.`);
          sendFeedbackToTwitch(`Democracy Input Selected: [ ${parsed.rawCommand} ] with ${maxVotes} votes!`);
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
  lastDemocracyWinner = null;
}

// Switch Mode
function setQueueMode(mode) {
  if (mode !== 'anarchy' && mode !== 'democracy') return false;
  
  config.queueMode = mode;
  saveConfig(config);
  
  if (mode === 'democracy') {
    inputQueue = [];
    startDemocracyLoop();
  } else {
    stopDemocracyLoop();
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
        if (consoleType === 'nes' || consoleType === 'gb') {
          config.activeConsole = consoleType;
          saveConfig(config);
          sendFeedbackToTwitch(`Console system set to [ ${consoleType.toUpperCase()} ] by admin @${username}.`);
        } else {
          sendFeedbackToTwitch(`Invalid console: ${args[0]}. Use 'nes' or 'gb'.`);
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
  // Tokenizer matching hold commands or combos/single buttons
  const tokenizer = /(?:hold\s+)?(?:a|b|up|down|left|right|select|start|u|d|l|r|sel|st)\s+\d+|(?:[a-z0-9+]+)/gi;
  const seqParts = commandToParse.match(tokenizer) || [];
  const parsedSequence = [];
  
  for (const part of seqParts) {
    if (!part) continue;
    const parsed = parseCommandText(part);
    if (parsed) {
      parsedSequence.push(parsed);
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
  
  if (isPaused) {
    return res.json({});
  }

  if (config.queueMode === 'democracy') {
    // Return last democracy winner if available
    const win = lastDemocracyWinner;
    // Clear it so BizHawk gets it once, or let it repeat depending on design.
    // For plays, we consume the winner once.
    lastDemocracyWinner = null;
    if (win) {
      broadcast('input_pressed', { buttons: win.buttons, user: win.user, command: win.rawCommand });
      return res.json(win);
    }
  } else {
    // Anarchy / FIFO Queue
    if (inputQueue.length > 0) {
      const nextInput = inputQueue.shift();
      broadcast('queue_updated', getQueueState());
      broadcast('input_pressed', { buttons: nextInput.buttons, user: nextInput.user, command: nextInput.rawCommand });
      return res.json(nextInput);
    }
  }

  return res.json({});
});

// Start Server
loadConfig();
initTwitch();

server.listen(PORT, () => {
  console.log(`Twitch Plays Server running at http://localhost:${PORT}`);
});
