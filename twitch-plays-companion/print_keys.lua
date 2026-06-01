-- Print Keys Diagnostics Script
-- Written by Antigravity

console.clear()
print("====================================================")
print("  PRINT KEYS DIAGNOSTICS                            ")
print("====================================================")

local result1 = ""
local inputs = joypad.get(1)
if inputs then
  local keys = {}
  for k, v in pairs(inputs) do
    table.insert(keys, tostring(k))
  end
  table.sort(keys)
  result1 = "Keys for joypad.get(1):\n" .. table.concat(keys, ", ")
  print(result1)
else
  result1 = "joypad.get(1) returned nil!"
  print(result1)
end

local result2 = ""
local global = joypad.get()
if global then
  local keys = {}
  for k, v in pairs(global) do
    table.insert(keys, tostring(k))
  end
  table.sort(keys)
  result2 = "Keys for global joypad.get():\n" .. table.concat(keys, ", ")
  print(result2)
else
  result2 = "global joypad.get() returned nil!"
  print(result2)
end

while true do
  -- Draw the text on the screen in big visible colors
  gui.drawRectangle(5, 5, 240, 120, 0xFF000000, 0xDD000000)
  gui.text(10, 10, "DIAGNOSTIC KEYS DISPLAY", 0xFFFF3333)
  gui.text(10, 30, result1, 0xFFFFCC00)
  gui.text(10, 80, result2, 0xFF00FFFF)
  emu.frameadvance()
end
