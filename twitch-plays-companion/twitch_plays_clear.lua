-- BizHawk 2.11.1 Twitch Plays Lua Script (CLEAR / NO-HUD VERSION)
-- Written by Antigravity

console.clear()
print("-------------------------------------------------------------")
print("  BizHawk Twitch Plays Integration script (CLEAR / NO-HUD)   ")
print("  Target version: BizHawk 2.11.1                             ")
print("-------------------------------------------------------------")

-- Polling Configs
local POLL_URL = "http://localhost:8080/api/poll"
local EMPTY_POLL_COOLDOWN = 10 -- Wait 10 frames before repolling if queue was empty
local OFFLINE_RETRY_COOLDOWN = 180 -- Wait 3 seconds (180 frames) if server is offline

-- Script States
local STATE_IDLE = "IDLE"
local STATE_PRESS = "PRESS"
local STATE_RELEASE = "RELEASE"

local state = STATE_IDLE
local framesLeft = 0
local activeButtons = {}
local activeUser = ""
local activeCommand = ""
local activeReleaseFrames = 4

local pendingTask = nil
local pollCooldown = 0
local serverOnline = false
local serverOfflineTimer = 0
local emptyPollLogTimer = 0

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

print("Twitch Plays Controller listening on: " .. POLL_URL)

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

-- Draw On-Screen HUD Overlay (Disabled in CLEAR version)
local function drawHUD()
  -- No-op: No visual overlay feedback drawn on emulator screen
end

-- Synchronous WebRequest Poller (Timeout safe)
local function makeWebRequestSync()
  local json = nil
  local requestOk, requestErr = pcall(function()
    local req = HttpWebRequest.Create(POLL_URL)
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
  -- Draw Streamer HUD (No-op in this clear version)
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

    if not pendingTask and pollCooldown <= 0 and serverOfflineTimer <= 0 then
      if http_client_available then
        -- Method 1: Async HttpClient Polling
        local ok, err = pcall(function()
          pendingTask = http:GetStringAsync(POLL_URL)
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
          serverOnline = true
          if json ~= "" and json ~= "{}" then
            print("[POLL] HTTP request returned raw JSON: " .. json)
            local cmd = parseJson(json)
            if cmd then
              activeButtons = cmd.buttons
              activeUser = cmd.user
              activeCommand = cmd.commandText
              activeReleaseFrames = cmd.releaseFrames
              
              state = STATE_PRESS
              framesLeft = cmd.holdFrames
              
              print(string.format("Chatter @%s pressed: %s (Hold: %df, Release: %df)", 
                cmd.user, cmd.commandText, cmd.holdFrames, cmd.releaseFrames))
              
              -- Talk back exact keys passed to joypad.set!
              local keys_applied = {}
              for k, v in pairs(activeButtons) do
                if v then table.insert(keys_applied, tostring(k)) end
              end
              table.sort(keys_applied)
              print("  -> Joypad keys set: {" .. table.concat(keys_applied, ", ") .. "}")
            else
              print("[POLL] parseJson failed to find any valid buttons in the JSON!")
              pollCooldown = EMPTY_POLL_COOLDOWN
            end
          else
            if shouldLog then
              print("[POLL] Received empty payload (server input queue is empty).")
            end
            pollCooldown = EMPTY_POLL_COOLDOWN
          end
        else
          serverOnline = false
          serverOfflineTimer = OFFLINE_RETRY_COOLDOWN
          print("Companion server offline. Retrying... Error details: " .. tostring(err))
        end
      end
    end

    -- Process Completed Tasks (Async only)
    if http_client_available and pendingTask then
      if pendingTask.IsCompleted then
        local isFaulted = pendingTask.IsFaulted
        
        if not isFaulted then
          serverOnline = true
          local ok, json = pcall(function() return pendingTask.Result end)
          pendingTask = nil

          if ok and json and json ~= "" and json ~= "{}" then
            print("[POLL] Async HTTP returned raw JSON: " .. json)
            local cmd = parseJson(json)
            if cmd then
              activeButtons = cmd.buttons
              activeUser = cmd.user
              activeCommand = cmd.commandText
              activeReleaseFrames = cmd.releaseFrames
              
              state = STATE_PRESS
              framesLeft = cmd.holdFrames
              
              print(string.format("Chatter @%s pressed: %s (Hold: %df, Release: %df)", 
                cmd.user, cmd.commandText, cmd.holdFrames, cmd.releaseFrames))
              
              -- Talk back exact keys passed to joypad.set!
              local keys_applied = {}
              for k, v in pairs(activeButtons) do
                if v then table.insert(keys_applied, tostring(k)) end
              end
              table.sort(keys_applied)
              print("  -> Joypad keys set: {" .. table.concat(keys_applied, ", ") .. "}")
            else
              print("[POLL] parseJson failed to find any valid buttons in the async JSON!")
              pollCooldown = EMPTY_POLL_COOLDOWN
            end
          else
            pollCooldown = EMPTY_POLL_COOLDOWN
          end
        else
          serverOnline = false
          pendingTask = nil
          serverOfflineTimer = OFFLINE_RETRY_COOLDOWN
          print("Companion server offline. Retrying...")
        end
      end
    end
  end

  -- Advance emulation by exactly one frame
  emu.frameadvance()
end
