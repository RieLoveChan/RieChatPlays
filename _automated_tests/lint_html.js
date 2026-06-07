/**
 * HTML and Inline JS Linter Script
 * Stored in _automated_tests as per repository guidelines.
 * Validates HTML tags balancing, duplicate IDs, and compiles inline scripts using Node.js vm module.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_FILE_PATH = path.join(__dirname, '..', 'twitch-plays-companion', 'public', 'index.html');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function lintHtmlFile(filePath) {
  console.log(`Linting HTML file: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File does not exist at ${filePath}`);
    process.exit(1);
  }

  const rawHtml = fs.readFileSync(filePath, 'utf8');
  let hasErrors = false;

  // 1. Check duplicate IDs
  console.log('\n--- Checking Unique IDs ---');
  const cleanHtmlForIds = rawHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '');
  const idRegex = /id=["']([^"']+)["']/g;
  const ids = {};
  const duplicateIds = [];
  let match;
  while ((match = idRegex.exec(cleanHtmlForIds)) !== null) {
    const id = match[1];
    if (ids[id]) {
      duplicateIds.push(id);
    }
    ids[id] = (ids[id] || 0) + 1;
  }

  if (duplicateIds.length > 0) {
    hasErrors = true;
    console.error(`❌ Found duplicate IDs in HTML: ${Array.from(new Set(duplicateIds)).join(', ')}`);
  } else {
    console.log('✔ All element IDs are unique.');
  }

  // 2. Structural Tag Balancing check
  console.log('\n--- Checking HTML Tag Balance ---');
  const cleanHtml = rawHtml.replace(/<!--[\s\S]*?-->/g, ''); // strip HTML comments
  const tagRegex = /<(\/)?([a-zA-Z0-9:-]+)([^>]*?)>/g;
  const stack = [];
  const unmatchedClosings = [];
  const mismatchedTags = [];

  // Helper to count lines of code to report accurate error positions
  const getLineNumber = (index) => {
    return cleanHtml.substring(0, index).split('\n').length;
  };

  while ((match = tagRegex.exec(cleanHtml)) !== null) {
    const isClosing = !!match[1];
    const tagName = match[2].toLowerCase();
    const attributes = match[3];

    // Skip void tags and self-closing tags
    if (VOID_TAGS.has(tagName) || attributes.trim().endsWith('/')) {
      continue;
    }

    if (isClosing) {
      if (stack.length === 0) {
        unmatchedClosings.push({ tag: tagName, line: getLineNumber(match.index) });
      } else {
        const top = stack.pop();
        if (top.name !== tagName) {
          mismatchedTags.push({
            expected: top.name,
            got: tagName,
            openLine: top.line,
            closeLine: getLineNumber(match.index)
          });
        }
      }
    } else {
      stack.push({ name: tagName, index: match.index, line: getLineNumber(match.index) });
    }
  }

  if (unmatchedClosings.length > 0) {
    hasErrors = true;
    unmatchedClosings.forEach(err => {
      console.error(`❌ Unexpected closing tag </${err.tag}> on line ${err.line} with no matching opening tag.`);
    });
  }

  if (mismatchedTags.length > 0) {
    hasErrors = true;
    mismatchedTags.forEach(err => {
      console.error(`❌ Mismatched tags: Expected </${err.expected}> (opened on line ${err.openLine}) but got </${err.got}> on line ${err.closeLine}`);
    });
  }

  if (stack.length > 0) {
    hasErrors = true;
    console.error('❌ Unclosed structural HTML tags remaining at end of file:');
    stack.forEach(item => {
      console.error(`  - <${item.name}> opened on line ${item.line}`);
    });
  }

  if (unmatchedClosings.length === 0 && mismatchedTags.length === 0 && stack.length === 0) {
    console.log('✔ Structural HTML tags are balanced.');
  }

  // 3. Extract and compile JS script blocks
  console.log('\n--- Checking Inline JavaScript Syntax ---');
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptCount = 0;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(rawHtml)) !== null) {
    const scriptCode = scriptMatch[1].trim();
    if (!scriptCode) continue;

    scriptCount++;
    const startIdx = scriptMatch.index + scriptMatch[0].indexOf(scriptCode);
    const startLine = rawHtml.substring(0, startIdx).split('\n').length;
    
    try {
      // Create script container to dry-compile Javascript syntactically
      new vm.Script(scriptCode, { filename: `index.html:script[line ${startLine}]` });
      console.log(`✔ Script block #${scriptCount} (starting line ${startLine}) compiled successfully.`);
    } catch (err) {
      hasErrors = true;
      console.error(`❌ JavaScript Syntax Error in Script block #${scriptCount} (starting line ${startLine}):`);
      console.error(`   ${err.stack || err.message}`);
    }
  }

  if (scriptCount === 0) {
    console.log('No inline JavaScript script blocks found.');
  }

  console.log('\n====================================================');
  if (hasErrors) {
    console.error('❌ LINTING COMPLETED WITH ERRORS.');
    process.exit(1);
  } else {
    console.log('🎉 LINTING COMPLETED SUCCESSFULLY. NO ERRORS FOUND.');
  }
}

lintHtmlFile(HTML_FILE_PATH);
