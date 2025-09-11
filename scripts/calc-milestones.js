#!/usr/bin/env node
/*
  Simple milestone progress calculator.
  Parses the "## Milestone Tracker" section of PROJECT_PLAN.md and prints per-milestone and overall completion.
*/
const fs = require('fs');
const path = require('path');

const planPath = path.join(process.cwd(), 'PROJECT_PLAN.md');
if (!fs.existsSync(planPath)) {
  console.error('PROJECT_PLAN.md not found.');
  process.exit(1);
}

const md = fs.readFileSync(planPath, 'utf8');

// Extract the Milestone Tracker section
const sectionStart = md.indexOf('## Milestone Tracker');
if (sectionStart === -1) {
  console.error('No "## Milestone Tracker" section found in PROJECT_PLAN.md');
  process.exit(1);
}
const rest = md.slice(sectionStart);
// End at the next top-level section header or EOF
const nextHeaderIdx = rest.indexOf('\n## ');
const section = nextHeaderIdx === -1 ? rest : rest.slice(0, nextHeaderIdx);

// Split by per-milestone subheaders (### ...)
const parts = section.split(/\n### /g).slice(1); // first item before first ### is intro text

if (parts.length === 0) {
  console.error('No milestone subsections (###) found under Milestone Tracker.');
  process.exit(1);
}

let overallDone = 0;
let overallTotal = 0;

console.log('Milestone Progress');
console.log('==================');

for (const block of parts) {
  const lines = block.split(/\r?\n/);
  const title = (lines[0] || '').trim();
  let done = 0;
  let total = 0;
  for (const line of lines.slice(1)) {
    // Match checkboxes like: - [x] Task or - [ ] Task
    const m = line.match(/^\s*-\s*\[( |x|X)\]/);
    if (m) {
      total += 1;
      if (m[1].toLowerCase() === 'x') done += 1;
    }
    // Stop at next subsection
    if (line.startsWith('### ')) break;
  }
  overallDone += done;
  overallTotal += total;
  const pct = total ? ((done / total) * 100).toFixed(1) : '0.0';
  console.log(`- ${title}: ${done}/${total} (${pct}%)`);
}

const overallPct = overallTotal ? ((overallDone / overallTotal) * 100).toFixed(1) : '0.0';
console.log('------------------');
console.log(`Overall: ${overallDone}/${overallTotal} (${overallPct}%)`);

