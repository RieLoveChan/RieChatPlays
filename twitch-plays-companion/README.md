# BizHawk 2.11.1 Twitch Plays Integration Companion

Welcome! This package is a premium, high-fidelity integration designed to connect Twitch Chat directly to the BizHawk emulator (v2.11.1), starting with complete support for **NES** and **GameBoy** (GB) controls. 

It contains a robust Node.js backend server, a gorgeous web dashboard for the streamer, transparent OBS virtual controller overlays, automated timing algorithms, and a performance-optimized BizHawk Lua script.

---

## Key Features

1. **Dual Console Layouts**: Pixel-perfect virtual GameBoy and NES controllers that depress and glow in real-time on stream as chat commands are processed.
2. **Timing Control Engine**: Configurable **Hold Frames** (how long a button is held down) and **Release Frames** (the safety gap between presses) to guarantee standard retro games (e.g. Pokémon, Super Mario Bros) register consecutive button inputs perfectly.
3. **Queue Mode Modulations**:
   - **Anarchy Mode**: Classic immediate FIFO (first-come, first-served) queue execution. Supports parsing multi-button combos (e.g., `up+a`), sequences (e.g., `u d l r` queued sequentially), and customized hold durations (e.g., `hold a 30`).
   - **Democracy Mode**: Live voting cycle (e.g. 15s). Chat votes on the next input, displaying interactive glow bar percentages, and executes the winning command.
4. **Streamer Control Center**: Glassmorphic, modern dashboard displaying server connection metrics, real-time input scrolling logs, user settings editor, and statistics widgets (most used keys, top players standing).
5. **No Twitch Developer Bloat**: Connects **anonymously** in read-only mode by default—just enter your Twitch channel name and start reading chat immediately!
6. **Chat Feedback bot**: If a bot username and OAuth token are supplied, the bot will message your chat with command receipts, Timing adjustments, error feedbacks, and democracy winners.
7. **Mod Administrative Controls**: Designate administrative permissions (mods, broadcaster, custom list) to control emulation directly from Twitch chat (e.g. `!pause`, `!resume`, `!clear`, `!mode anarchy`, etc.).
8. **Fault-Tolerant BizHawk Lua Script**: Safe C# asynchronous polling client that will NEVER freeze the emulator even if your server restarts or goes offline, drawing a sleek translucent stats HUD directly on the game window.

---

## Directory Structure

```
twitch-plays-companion/
├── server.js               # Node.js Express & WebSocket server
├── config.json             # Dynamics configurations file (credentials & options)
├── package.json            # Node.js server dependencies
├── run.bat                 # One-click companion app launcher
├── twitch_plays.lua        # BizHawk Lua polling script
├── public/                 # Static web client (dashboard & overlays)
│   ├── index.html          # Glassmorphic Streamer Dashboard
│   ├── overlay.html        # Transparent OBS Virtual Controller Overlay
│   └── app.css             # Neon purple style guidelines
└── automated_tests/        # Full automated test suite
    ├── test_server_api.js  # API and Queue integration tests
    ├── test_chat_simulation.js # Cooldown and Democracy simulation tests
    └── run_tests.bat       # One-click test runner
```

---

## Quick Start Guide

### 1. Launch the Companion Server
1. Ensure [Node.js](https://nodejs.org) is installed on your PC.
2. Double-click `run.bat` inside the `twitch-plays-companion` folder.
3. The launcher will automatically check dependencies (`npm install`), boot the backend server, and open your **Streamer Dashboard** in your browser at `http://localhost:8080`.

### 2. Configure Twitch Credentials
1. On the dashboard's left panel, enter your **Twitch Channel** name (e.g., `rie_plays`).
2. *(Optional)* Enter a **Bot Username** and **Twitch OAuth Token** (you can generate one from [Twitch Token Generator](https://twitchtokengenerator.com)) if you want the bot to reply to chat. Leave them blank to run in anonymous read-only mode.
3. Enter any **Admin Users** who can manage controls in chat (mods and the broadcaster are admins by default).
4. Select your **Active Console** system (NES or GameBoy).
5. Adjust hold durations and click **Save Settings**. The server will automatically connect to Twitch Chat in the background!

### 3. Setup BizHawk 2.11.1 Emulator
1. Start BizHawk and load a NES or GameBoy ROM (e.g. Pokémon Red, Super Mario Bros).
2. Open the Lua Console (**Tools > Lua Console**).
3. Drag-and-drop the `twitch_plays.lua` script (inside `twitch-plays-companion`) into the Lua Console window.
4. You will see a beautiful HUD overlay appear on the top-left of your game screen saying `TWITCH PLAYS: ONLINE`.
5. You're ready to play!

### 4. Setup OBS Overlay HUD
1. In OBS Studio, add a new **Browser Source**.
2. Set the URL to:
   - For NES: `http://localhost:8080/overlay.html?controller=nes`
   - For GameBoy: `http://localhost:8080/overlay.html?controller=gb`
3. Set the width to `1000` and height to `450`.
4. Make sure "Shutdown source when not visible" is checked. You will now see a gorgeous, glowing retro controller on stream that lights up in real-time as your chat plays the game!

---

## Commands Reference

### Chatter Input Commands
Chatters can enter commands in your Twitch Chat channel:
* **Single Keys**: `a`, `b`, `up` (or `u`), `down` (or `d`), `left` (or `l`), `right` (or `r`), `start` (or `st`), `select` (or `sel`).
* **Combinations (Combos)**: Press buttons simultaneously by connecting them with `+`, e.g. `up+a`, `right+b`, `left+start`.
* **Holds**: Hold down a button for specific frames (max 120f) by specifying the frames, e.g. `hold a 30`, `b 60`.
* **Sequences**: Send multiple consecutive inputs by separating them with spaces or commas, e.g. `up, down, left, right, a, b` or `u d l r a b` (will execute one-by-one).

### Admin Commands in Chat
Broadcasters, moderators, and users listed in `adminUsers` can type control commands in chat starting with `!` (or your custom prefix):
* `!pause` — Pauses input execution.
* `!resume` — Resumes input execution.
* `!clear` — Clears the queue and resets democracy votes.
* `!mode anarchy` — Switches queue to Anarchy Mode.
* `!mode democracy` — Switches queue to Democracy Mode.
* `!cooldown [seconds]` — Updates user-level input cooldown (e.g., `!cooldown 5`).
* `!hold [frames]` — Set default button press duration (e.g., `!hold 10`).
* `!release [frames]` — Set safety gap duration (e.g., `!release 5`).
* `!console nes` / `!console gb` — Switches active virtual controller layout.

---

## Developer Testing Suite

We have written a high-fidelity automated test suite to verify the system. 
To run all tests:
1. Open the `automated_tests` folder.
2. Double-click `run_tests.bat`.
3. It will automatically run integration API checks (`test_server_api.js`) and queue/democracy simulation checks (`test_chat_simulation.js`) and print complete verification logs.
