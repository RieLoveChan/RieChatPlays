-- BizHawk 2.11.1 Chat Plays Lua Script (Base / Clear Version)
-- Written by Antigravity

console.clear()

-- Save the original console print function
local original_print = print

-- Determine script directory path
local script_path = debug.getinfo(1).source:match("@?(.*[\\/])") or ""
-- Ensure logs directory exists (silent mkdir command for Windows)
os.execute('mkdir "' .. script_path .. 'logs" 2>nul')

-- Helper to check if a file exists
local function file_exists(path)
  local f = io.open(path, "r")
  if f then
    f:close()
    return true
  else
    return false
  end
end

-- Find next available log file in YYYYMMDD_HHMM_N.log format
local function get_log_filepath(dir)
  local date_str = os.date("%Y%m%d_%H%M")
  local n = 1
  while true do
    local path = dir .. "logs/" .. date_str .. "_" .. n .. ".log"
    if not file_exists(path) then
      return path
    end
    n = n + 1
  end
end

local log_filepath = get_log_filepath(script_path)

-- Open log file in append mode
local log_file, err = io.open(log_filepath, "a")
if log_file then
  log_file:write("\n=== LOG STARTED AT " .. os.date("%Y-%m-%d %H:%M:%S") .. " ===\n")
  log_file:flush()
else
  original_print("[WARNING] Could not open log file: " .. tostring(err))
end

-- Helper to check if a message is an error or warning (case-insensitive search)
local function is_warning_or_error(msg)
  local lower_msg = msg:lower()
  return lower_msg:find("warning") or 
         lower_msg:find("error") or 
         lower_msg:find("fail") or 
         lower_msg:find("critical") or 
         lower_msg:find("offline") or 
         lower_msg:find("disconnect")
end

-- Override global print to only output and log warnings/errors
print = function(...)
  local args = {...}
  for i = 1, #args do
    args[i] = tostring(args[i])
  end
  local message = table.concat(args, "\t")
  
  if is_warning_or_error(message) then
    -- Print to BizHawk Lua Console
    original_print(message)
    
    -- Write to log file if open
    if log_file then
      log_file:write(message .. "\n")
      log_file:flush()
    end
  end
end

-- Close log file cleanly when the script stops/is closed in BizHawk
event.onexit(function()
  if log_file then
    log_file:write("=== LOG ENDED AT " .. os.date("%Y-%m-%d %H:%M:%S") .. " ===\n\n")
    log_file:close()
    log_file = nil
  end
end)
print("  BizHawk Chat Plays Integration script   ")
print("  Target version: BizHawk 2.11.1          ")

-- Polling Configs
local POLL_URL = "http://localhost:8080/api/poll"
local BASE_POLL_COOLDOWN = 30 -- Base frames to wait before repolling if queue was empty
local POLL_COOLDOWN_STEP = 20 -- Cooldown increment per empty poll
local MAX_POLL_COOLDOWN = 180 -- Max frames to wait (adaptive backoff limit)
local OFFLINE_RETRY_COOLDOWN = 300 -- Wait 5 seconds (300 frames) if server is offline

-- URL Encoding helper for passing ROM name to server
local function urlEncode(str)
  if not str then return "" end
  str = str:gsub("\n", "\r\n")
  str = str:gsub("([^%w %-%_%.%~])", function (c) return string.format ("%%%02X", string.byte(c)) end)
  str = str:gsub(" ", "%%20")
  return str
end

-- Safely retrieve ROM name from BizHawk
local function getRomName()
  if gameinfo and gameinfo.getromname then
    local name = gameinfo.getromname()
    if name and name ~= "" then
      return name
    end
  end
  return ""
end

-- Process auto-savestate commands from JSON payload
local function processSaveStateFromJson(json)
  if not json or json == "" or json == "{}" then return end
  local saveStatePath = json:match('"saveStatePath"%s*:%s*"([^"]+)"')
  if saveStatePath then
    -- Clean up escaped backslashes from JSON string
    saveStatePath = saveStatePath:gsub("\\\\", "\\")
    print("[AUTO-SAVE] Triggering emulator savestate to path: " .. saveStatePath)
    local ok, err = pcall(function()
      savestate.save(saveStatePath)
    end)
    if ok then
      print("[AUTO-SAVE] Successfully saved state!")
    else
      print("[AUTO-SAVE] Error saving state: " .. tostring(err))
    end
  end
end

-- Script States (Global for Add-on/HUD visibility)
STATE_IDLE = "IDLE"
STATE_PRESS = "PRESS"
STATE_RELEASE = "RELEASE"

state = STATE_IDLE
activeUser = ""
activeCommand = ""
serverOnline = false

local framesLeft = 0
local activeButtons = {}
local activeReleaseFrames = 4

local localQueue = {}
local currentEmptyPollCooldown = BASE_POLL_COOLDOWN

local pendingTask = nil
local pollCooldown = 0
local serverOfflineTimer = 0
local emptyPollLogTimer = 0
local serverOfflineLogged = false

-- HTTP CLIENT CONFIGURATION & FALLBACKS
local http_client_available = false
local use_http_web_request = false

local HttpClient = nil
local HttpWebRequest = nil
local StreamReader = nil
local TimeSpan = nil
local http = nil

-- Attempt 1: Try System.Net.Http.HttpClient (loaded dynamically)
local ok = pcall(function()
  luanet.load_assembly("System.Net.Http")
  HttpClient = luanet.import_type("System.Net.Http.HttpClient")
  TimeSpan = luanet.import_type("System.TimeSpan")
end)

if ok and HttpClient then
  local clientOk, clientErr = pcall(function()
    http = HttpClient()
    http.Timeout = TimeSpan.FromMilliseconds(200) -- Fail fast
  end)
  if clientOk then
    http_client_available = true
    print("Using System.Net.Http.HttpClient (Async) for polling.")
  end
end

if not http_client_available then
  -- Attempt 2: Fall back to System.Net.HttpWebRequest (from standard System assembly)
  local ok2 = pcall(function()
    luanet.load_assembly("System")
    HttpWebRequest = luanet.import_type("System.Net.HttpWebRequest")
    StreamReader = luanet.import_type("System.IO.StreamReader")
  end)
  
  if ok2 and HttpWebRequest then
    use_http_web_request = true
    print("HttpClient failed to load. Using robust System.Net.HttpWebRequest (Sync, 150ms timeout).")
  else
    error("Critical Error: Both HttpClient and HttpWebRequest could not be loaded via luanet!")
  end
end

print("Chat Plays Controller listening on: " .. POLL_URL)

-- Simple JSON parsing function (Regex-based)
local function parseJson(json)
  if not json or json == "" or json == "{}" then
    return nil
  end

  local buttons = {}
  local hasButtons = false
  
  -- Isolate the "buttons" object substring safely
  local buttons_part = json:match('"buttons"%s*:%s*({[^}]+})')
  if buttons_part then
    for btn in buttons_part:gmatch('"([^"]+)"%s*:%s*true') do
      buttons[btn] = true
      buttons["P1 " .. btn] = true -- Double-safe player prefix mapping
      hasButtons = true
    end
  end

  local isWait = json:match('"isWait"%s*:%s*true') ~= nil

  if not hasButtons and not isWait then
    return nil
  end

  local holdFrames = tonumber(json:match('"holdFrames"%s*:%s*(%d+)')) or 8
  local releaseFrames = tonumber(json:match('"releaseFrames"%s*:%s*(%d+)')) or 4
  local user = json:match('"user"%s*:%s*"([^"]+)"') or "Anonymous"
  local commandText = json:match('"commandText"%s*:%s*"([^"]+)"') or "Input"

  return {
    buttons = buttons,
    holdFrames = holdFrames,
    releaseFrames = releaseFrames,
    user = user,
    commandText = commandText,
    isWait = isWait
  }
end

-- Helper to split a JSON array of objects by counting braces
local function splitJsonArray(jsonStr)
  local objs = {}
  local depth = 0
  local startIdx = nil
  for i = 1, #jsonStr do
    local char = jsonStr:sub(i, i)
    if char == "{" then
      depth = depth + 1
      if depth == 1 then
        startIdx = i
      end
    elseif char == "}" then
      depth = depth - 1
      if depth == 0 and startIdx then
        table.insert(objs, jsonStr:sub(startIdx, i))
        startIdx = nil
      end
    end
  end
  return objs
end

-- Helper to pop the next command from local queue and transition the state machine
local function popNextLocalCommand()
  if #localQueue > 0 then
    local cmd = table.remove(localQueue, 1)
    activeButtons = cmd.buttons
    activeUser = cmd.user
    activeCommand = cmd.commandText
    
    local hold = cmd.holdFrames
    local release = cmd.releaseFrames
    
    activeReleaseFrames = release
    state = STATE_PRESS
    framesLeft = hold
    
    print(string.format("Chatter @%s pressed: %s (Hold: %df, Release: %df) [Local Queue Size: %d]", 
      cmd.user, cmd.commandText, hold, release, #localQueue))
    
    local keys_applied = {}
    for k, v in pairs(activeButtons) do
      if v then table.insert(keys_applied, tostring(k)) end
    end
    table.sort(keys_applied)
    print("  -> Joypad keys set: {" .. table.concat(keys_applied, ", ") .. "}")
    
    currentEmptyPollCooldown = BASE_POLL_COOLDOWN -- Reset idle backoff cooldown
  else
    pollCooldown = currentEmptyPollCooldown
    currentEmptyPollCooldown = math.min(MAX_POLL_COOLDOWN, currentEmptyPollCooldown + POLL_COOLDOWN_STEP)
  end
end

-- Process auto-clear console commands from JSON payload
local function processClearConsoleFromJson(json)
  if not json or json == "" or json == "{}" then return end
  local clearConsole = json:match('"clearConsole"%s*:%s*true')
  if clearConsole then
    console.clear()
    print("[SYSTEM] Console cleared automatically to prevent emulator lag.")
  end
end

-- Helper to process a JSON poll response containing multiple commands
local function handlePollResult(json)
  processSaveStateFromJson(json)
  processClearConsoleFromJson(json)
  
  local commands_part = json:match('"commands"%s*:%s*%[(.-)%]')
  if commands_part and commands_part ~= "" then
    local cmd_jsons = splitJsonArray(commands_part)
    for _, cmd_json in ipairs(cmd_jsons) do
      local cmd = parseJson(cmd_json)
      if cmd then
        table.insert(localQueue, cmd)
      end
    end
  end
  
  popNextLocalCommand()
end

-- Draw On-Screen HUD Overlay (Placeholder/Hook for add-ons)
if not drawHUD then
  function drawHUD()
    -- No-op: No visual overlay feedback in base script by default
  end
end

-- Synchronous WebRequest Poller (Timeout safe)
local function makeWebRequestSync()
  local json = nil
  local requestOk, requestErr = pcall(function()
    local url = POLL_URL .. "?batch=1&game=" .. urlEncode(getRomName())
    local req = HttpWebRequest.Create(url)
    req.Timeout = 150 -- 150 milliseconds timeout
    local resp = req:GetResponse()
    local stream = resp:GetResponseStream()
    local reader = StreamReader(stream)
    json = reader:ReadToEnd()
    reader:Close()
    resp:Close()
  end)
  
  if requestOk then
    return json
  else
    return nil, requestErr
  end
end

-- Dynamic Port Support Auto-Detection at Startup
local has_port1_support = false
local test_port1 = joypad.get(1)
if test_port1 and next(test_port1) ~= nil then
  has_port1_support = true
  print("Dynamic Detection: Emulator core supports Player 1 port. Utilizing port-scoped controls.")
else
  print("Dynamic Detection: Emulator core does NOT support Player 1 port. Utilizing global-scoped controls.")
end

-- Register Event Callbacks for robust Input Injection
local lastStateLogged = ""
local function applyInputs()
  if state == STATE_PRESS then
    if lastStateLogged ~= "PRESS" then
      lastStateLogged = "PRESS"
      local keys_applied = {}
      for k, v in pairs(activeButtons) do
        if v then table.insert(keys_applied, tostring(k)) end
      end
      table.sort(keys_applied)
      print(string.format("[HOOK EVENT] state is PRESS. Applying active keys: {%s} (has_port1=%s)", 
        table.concat(keys_applied, ", "), tostring(has_port1_support)))
    end
    if has_port1_support then
      joypad.set(activeButtons, 1)
    else
      joypad.set(activeButtons)
    end
  else
    if lastStateLogged ~= "RELEASE" and lastStateLogged ~= "" then
      lastStateLogged = "RELEASE"
      print("[HOOK EVENT] state transitioned out of PRESS. Clearing inputs.")
    end
    if has_port1_support then
      joypad.set({}, 1)
    else
      joypad.set({})
    end
  end
end

event.oninputpoll(applyInputs)
event.onframestart(applyInputs)

-- Frame Advance Loop
while true do
  -- Draw Streamer HUD (Delegated to drawHUD hook)
  drawHUD()

  -- Check Server Cooldown Timer
  if serverOfflineTimer > 0 then
    serverOfflineTimer = serverOfflineTimer - 1
  end

  if pollCooldown > 0 then
    pollCooldown = pollCooldown - 1
  end

  -- STATE MACHINE
  if state == STATE_PRESS then
    framesLeft = framesLeft - 1
    
    if framesLeft <= 0 then
      state = STATE_RELEASE
      framesLeft = activeReleaseFrames or 4
    end

  elseif state == STATE_RELEASE then
    -- Gap phase: clear controls to allow consecutive tap registrations
    framesLeft = framesLeft - 1
    
    if framesLeft <= 0 then
      state = STATE_IDLE
    end

  elseif state == STATE_IDLE then
    -- Ready to process next command
    if #localQueue > 0 then
      popNextLocalCommand()
    else
      if not pendingTask and pollCooldown <= 0 and serverOfflineTimer <= 0 then
        if http_client_available then
          -- Method 1: Async HttpClient Polling
          local ok, err = pcall(function()
            pendingTask = http:GetStringAsync(POLL_URL .. "?batch=1&game=" .. urlEncode(getRomName()))
          end)
          
          if not ok then
            print("Polling dispatch error: " .. tostring(err))
            serverOnline = false
            serverOfflineTimer = OFFLINE_RETRY_COOLDOWN
          end
        else
          -- Method 2: Synchronous HttpWebRequest Polling (Safe with 150ms timeout)
          emptyPollLogTimer = emptyPollLogTimer + 1
          local shouldLog = false
          if emptyPollLogTimer >= 300 then
            emptyPollLogTimer = 0
            shouldLog = true
            print("[POLL DIAL] Dispatching synchronous HTTP poll request to: " .. POLL_URL)
          end
          
          local json, err = makeWebRequestSync()
          if json then
            if not serverOnline then
              print("[POLL] Companion server connected successfully!")
              serverOfflineLogged = false
            end
            serverOnline = true
            if json ~= "" and json ~= "{}" then
              print("[POLL] HTTP request returned raw JSON: " .. json)
              handlePollResult(json)
            else
              if shouldLog then
                print("[POLL] Received empty payload (server input queue is empty).")
              end
              pollCooldown = currentEmptyPollCooldown
              currentEmptyPollCooldown = math.min(MAX_POLL_COOLDOWN, currentEmptyPollCooldown + POLL_COOLDOWN_STEP)
            end
          else
            if serverOnline or not serverOfflineLogged then
              print("[POLL] Companion server is offline. Will automatically reconnect when started.")
              serverOfflineLogged = true
            end
            serverOnline = false
            serverOfflineTimer = OFFLINE_RETRY_COOLDOWN
          end
        end
      end

      -- Process Completed Tasks (Async only)
      if http_client_available and pendingTask then
        if pendingTask.IsCompleted then
          local isFaulted = pendingTask.IsFaulted
          
          if not isFaulted then
            local ok, json = pcall(function() return pendingTask.Result end)
            pendingTask = nil

            if ok and json then
              if not serverOnline then
                print("[POLL] Companion server connected successfully!")
                serverOfflineLogged = false
              end
              serverOnline = true
              if json ~= "" and json ~= "{}" then
                print("[POLL] Async HTTP returned raw JSON: " .. json)
                handlePollResult(json)
              else
                pollCooldown = currentEmptyPollCooldown
                currentEmptyPollCooldown = math.min(MAX_POLL_COOLDOWN, currentEmptyPollCooldown + POLL_COOLDOWN_STEP)
              end
            else
              pollCooldown = currentEmptyPollCooldown
              currentEmptyPollCooldown = math.min(MAX_POLL_COOLDOWN, currentEmptyPollCooldown + POLL_COOLDOWN_STEP)
            end
          else
            if serverOnline or not serverOfflineLogged then
              print("[POLL] Companion server is offline. Will automatically reconnect when started.")
              serverOfflineLogged = true
            end
            serverOnline = false
            pendingTask = nil
            serverOfflineTimer = OFFLINE_RETRY_COOLDOWN
          end
        end
      end
    end
  end

  -- Advance emulation by exactly one frame
  emu.frameadvance()
end
