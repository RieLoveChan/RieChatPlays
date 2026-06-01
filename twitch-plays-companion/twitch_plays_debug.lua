-- BizHawk Input Diagnostics & Verification Script
-- Written by Antigravity

console.clear()
print("====================================================")
print("  BIZHAWK INPUT DIAGNOSTICS & VERIFICATION SCRIPT   ")
print("====================================================")

-- 1. Dynamic Port Detection
local has_port1_support = false
local test_port1 = joypad.get(1)
if test_port1 and next(test_port1) ~= nil then
  has_port1_support = true
  print("\n[DETECT] Core supports Player 1 port. Utilizing port-scoped controls.")
else
  print("\n[DETECT] Core does NOT support Player 1 port. Utilizing global-scoped controls.")
end

-- 2. Scan and Print Core Buttons
print("\n[STEP 1] Scanning active core button bindings...")
if test_port1 then
  local keys = {}
  for k, _ in pairs(test_port1) do
    table.insert(keys, tostring(k))
  end
  table.sort(keys)
  print("Active buttons returned by joypad.get(1):")
  print("{" .. table.concat(keys, ", ") .. "}")
else
  print("[WARNING] joypad.get(1) returned nil.")
end

local global_inputs = joypad.get()
if global_inputs then
  local keys = {}
  for k, _ in pairs(global_inputs) do
    table.insert(keys, tostring(k))
  end
  table.sort(keys)
  print("\nActive buttons returned by global joypad.get():")
  print("{" .. table.concat(keys, ", ") .. "}")
else
  print("[WARNING] joypad.get() returned nil.")
end

-- 3. Test Sequence including raw global tests (crucial for GB cores without port support!)
local tests = {
  { label = "Start (Raw Global - NO PORT)", buttons = { ["Start"] = true }, use_port = false },
  { label = "Start (Raw with port 1)", buttons = { ["Start"] = true }, use_port = true },
  { label = "Start (Prefixed global)", buttons = { ["P1 Start"] = true }, use_port = false },
  { label = "Start (Double-Safe with port 1)", buttons = { ["Start"] = true, ["P1 Start"] = true }, use_port = true },
  
  { label = "A (Raw Global - NO PORT)", buttons = { ["A"] = true }, use_port = false },
  { label = "A (Raw with port 1)", buttons = { ["A"] = true }, use_port = true },
  { label = "A (Prefixed global)", buttons = { ["P1 A"] = true }, use_port = false },
  { label = "A (Double-Safe with port 1)", buttons = { ["A"] = true, ["P1 A"] = true }, use_port = true },
  
  { label = "B (Raw Global - NO PORT)", buttons = { ["B"] = true }, use_port = false },
  { label = "Up (Raw Global - NO PORT)", buttons = { ["Up"] = true }, use_port = false },
}

local currentTestIdx = 1
local framesInState = 0
local testInterval = 120 -- 2 seconds at 60fps
local holdDuration = 30  -- 0.5 seconds hold
local activeButtons = {}
local activeUsePort = false
local activeLabel = "None"
local isHolding = false

-- 4. Register Event Callback for robust input injection
local function applyInputs()
  if isHolding then
    if activeUsePort then
      joypad.set(activeButtons, 1)
    else
      joypad.set(activeButtons)
    end
  else
    if has_port1_support then
      joypad.set({}, 1)
    else
      joypad.set({})
    end
  end
end

event.oninputpoll(applyInputs)
event.onframestart(applyInputs)

print("\n[STEP 2] Starting interactive input tests...")
print("Every 2 seconds, a button press test will execute.")
print("Watch the game screen and console to see which test causes in-game actions.")
print("Especially check if 'Start (Raw Global - NO PORT)' pops open the game menu!")

while true do
  framesInState = framesInState + 1
  
  if framesInState >= testInterval then
    -- Move to next test
    framesInState = 0
    currentTestIdx = currentTestIdx + 1
    if currentTestIdx > #tests then
      currentTestIdx = 1
    end
    
    local test = tests[currentTestIdx]
    activeButtons = test.buttons
    activeUsePort = test.use_port
    activeLabel = test.label
    isHolding = true
    
    -- Talk back! Print test details
    print(string.format("\n[TEST %d/%d] Triggering: %s", currentTestIdx, #tests, activeLabel))
    local keys_applied = {}
    for k, v in pairs(activeButtons) do
      table.insert(keys_applied, tostring(k))
    end
    
    if activeUsePort then
      print(string.format("  -> Calling: joypad.set({ %s }, 1)", 
        table.concat(keys_applied, " = true, ") .. " = true"))
    else
      print(string.format("  -> Calling: joypad.set({ %s })  [GLOBAL]", 
        table.concat(keys_applied, " = true, ") .. " = true"))
    end
  end
  
  if isHolding and framesInState >= holdDuration then
    isHolding = false
  end
  
  -- Render HUD Overlay
  gui.drawRectangle(5, 5, 230, 50, 0xFF333333, 0xCC000000)
  gui.text(12, 10, "INPUT DIAGNOSTICS ACTIVE", 0xFFFF3333)
  if isHolding then
    gui.text(12, 24, "TEST: " .. activeLabel, 0xFF00FF00)
    gui.text(12, 38, "STATUS: PRESSING BUTTON...", 0xFFFFFF00)
  else
    gui.text(12, 24, "NEXT: " .. tests[currentTestIdx == #tests and 1 or currentTestIdx + 1].label, 0xFF888888)
    gui.text(12, 38, "STATUS: RELEASE GAP", 0xFF888888)
  end
  
  emu.frameadvance()
end
