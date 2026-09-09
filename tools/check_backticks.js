import fs from 'fs'
const path = 'C:/Users/Rei Zerimar/OneDrive/Documents/Projects/Brgy legaspi/src/App.jsx'
const s = fs.readFileSync(path, 'utf8')
let inTpl = false
let line = 1, col = 0
for (let i = 0; i < s.length; i++) {
  const ch = s[i]
  col++
  if (ch === '\n') { line++; col = 0; continue }
  if (ch === '`') {
    inTpl = !inTpl
    console.log((inTpl ? 'ENTER' : 'EXIT') + ` at ${line}:${col} (index ${i})`)
    if (inTpl) {
      // show next 40 chars for context
      console.log('context opening ->', s.slice(i, i+40).replace(/\n/g,'\\n'))
    } else {
      console.log('context closing ->', s.slice(Math.max(0,i-40), i+1).replace(/\n/g,'\\n'))
    }
  }
}
console.log('final inTpl=', inTpl)
