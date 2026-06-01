const BUTTON_MAP = {
  'a': 'A', 'b': 'B', 'up': 'Up', 'u': 'Up', 'down': 'Down', 'd': 'Down',
  'left': 'Left', 'l': 'Left', 'right': 'Right', 'r': 'Right',
  'select': 'Select', 'sel': 'Select', 'start': 'Start', 'st': 'Start'
};

function parseCommandText(text) {
  const rawText = text.trim().toLowerCase();
  
  let holdMatch = rawText.match(/^(?:hold\s+)?(a|b|up|down|left|right|select|start|u|d|l|r|sel|st)\s+(\d+)$/i);
  if (holdMatch) {
    const rawBtn = holdMatch[1];
    const frames = Math.min(120, Math.max(1, parseInt(holdMatch[2], 10)));
    const mappedBtn = BUTTON_MAP[rawBtn];
    if (mappedBtn) {
      const buttons = {};
      buttons[`P1 ${mappedBtn}`] = true;
      return { buttons, holdFrames: frames, rawCommand: `${mappedBtn} (${frames}f)` };
    }
  }

  if (rawText.includes('+')) {
    const parts = rawText.split('+');
    const buttons = {};
    const validMapped = [];
    for (let part of parts) {
      const mapped = BUTTON_MAP[part.trim()];
      if (mapped) {
        buttons[`P1 ${mapped}`] = true;
        validMapped.push(mapped);
      }
    }
    if (validMapped.length > 0) {
      return { buttons, holdFrames: 8, rawCommand: validMapped.join('+') };
    }
  }

  const mappedBtn = BUTTON_MAP[rawText];
  if (mappedBtn) {
    const buttons = {};
    buttons[`P1 ${mappedBtn}`] = true;
    return { buttons, holdFrames: 8, rawCommand: mappedBtn };
  }

  return null;
}

const msg = "up+a hold b 35 u,d,l,r";
// Tokenizer matching hold commands or simple combos/single buttons
const tokenizer = /(?:hold\s+)?(?:a|b|up|down|left|right|select|start|u|d|l|r|sel|st)\s+\d+|(?:[a-z0-9+]+)/gi;
const seqParts = msg.match(tokenizer) || [];
console.log("seqParts:", seqParts);

const parsedSequence = [];
for (const part of seqParts) {
  if (!part) continue;
  const parsed = parseCommandText(part);
  console.log(`part "${part}":`, parsed);
  if (parsed) {
    parsedSequence.push(parsed);
  }
}
console.log("parsedSequence.length:", parsedSequence.length);
