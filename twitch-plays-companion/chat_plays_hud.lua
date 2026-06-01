-- BizHawk 2.11.1 Chat Plays HUD Add-on
-- Written by Antigravity
--
-- This is a visual HUD overlay add-on for the chat_plays.lua base script.
-- It intercepts the core drawHUD() hook to render status cards on screen.

print("-------------------------------------------------------------")
print("  BizHawk Chat Plays Integration HUD Add-on                  ")
print("  Target version: BizHawk 2.11.1                             ")
print("-------------------------------------------------------------")

-- Define the HUD Overlay rendering logic
function drawHUD()
  -- Draw Translucent Background card
  gui.drawRectangle(5, 5, 210, 52, 0xFF4A4B4E, 0xAA08090C)
  
  -- Render Server Connection Indicator
  if serverOnline then
    gui.text(12, 10, "TWITCH PLAYS: ONLINE", 0xFF00FF00)
  else
    gui.text(12, 10, "TWITCH PLAYS: OFFLINE", 0xFFFF0000)
  end

  -- Render active input commands and players
  if state == STATE_PRESS then
    gui.text(12, 24, "INPUT: " .. activeCommand:upper(), 0xFF00FFFF)
    gui.text(12, 38, "PLAYER: @" .. activeUser, 0xFFFFCC00)
  elseif state == STATE_RELEASE then
    gui.text(12, 24, "RELEASE GAP...", 0xFF999999)
    gui.text(12, 38, "NEXT COMMAND COMING", 0xFF999999)
  else
    gui.text(12, 24, "AWAITING CHAT COMMANDS", 0xFF999999)
  end
end

-- Resolve current directory and load the base script chat_plays.lua
local script_path = debug.getinfo(1).source:match("@?(.*[\\/])") or ""
print("Loading core functionality script from: " .. script_path .. "chat_plays.lua")
dofile(script_path .. "chat_plays.lua")
