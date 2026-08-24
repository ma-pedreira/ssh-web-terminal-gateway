// End-to-end check of the terminal gateway.
// Requires a running server and an SSH session that is already open.
//   SC=<ssh_web_session cookie> SID=<session id> node scripts/e2e-terminal.mjs
import WebSocket from 'ws'

const [cookie, sessionId] = [process.env.SC, process.env.SID]
const url = `ws://127.0.0.1:3030/api/terminal?session=${sessionId}`
const headers = { Cookie: `ssh_web_session=${cookie}`, Origin: 'http://127.0.0.1:3030' }
const decoder = new TextDecoder()

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    let text = ''
    const events = []
    ws.on('message', (data, isBinary) => {
      if (isBinary) text += decoder.decode(data, { stream: true })
      else events.push(JSON.parse(data.toString()))
    })
    ws.on('open', () => resolve({ ws, read: () => text, events }))
    ws.on('error', reject)
    setTimeout(() => reject(new Error(`timeout in ${label}`)), 8000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const marker = `VERIFICADO-${process.pid}`

// --- 1) attach and run a command ---
const first = await connect('first attach')
await wait(1200)
first.ws.send(JSON.stringify({ type: 'input', data: `echo ${marker}\n` }))
await wait(1500)
const output = first.read()
console.log('shell prompt received:', /[$#] ?$|probador/.test(output) ? 'yes' : 'no')
console.log('command executed on the remote host:', output.includes(marker) ? 'yes' : 'NO - FALLO')
console.log('status events:', JSON.stringify(first.events))

// --- 2) cross-origin rejection ---
const cross = new WebSocket(url, { headers: { Cookie: `ssh_web_session=${cookie}`, Origin: 'http://evil.example' } })
const crossResult = await new Promise((r) => {
  cross.on('unexpected-response', (_q, res) => r(`rejected with HTTP ${res.statusCode}`))
  cross.on('error', () => r('rejected'))
  cross.on('open', () => r('ACCEPTED - FAILURE'))
  setTimeout(() => r('no response'), 5000)
})
console.log('cross origin:', crossResult)

// --- 3) with no session cookie ---
const anon = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3030' } })
const anonResult = await new Promise((r) => {
  anon.on('unexpected-response', (_q, res) => r(`rejected with HTTP ${res.statusCode}`))
  anon.on('error', () => r('rejected'))
  anon.on('open', () => r('ACCEPTED - FAILURE'))
  setTimeout(() => r('no response'), 5000)
})
console.log('unauthenticated:', anonResult)

// --- 4) close the browser and come back: the session must survive ---
first.ws.close()
await wait(1500)
const second = await connect('re-attach')
await wait(1500)
const replay = second.read()
console.log('session survived the close:', replay.length > 0 ? 'yes' : 'NO - FALLO')
console.log('buffer repainted the earlier output:', replay.includes(marker) ? 'yes' : 'NO - FALLO')

// The command is still alive in the SAME remote session, not a new shell.
second.ws.send(JSON.stringify({ type: 'input', data: 'echo SEGUNDA-VUELTA\n' }))
await wait(1500)
console.log('session still works after re-attaching:', second.read().includes('SECOND-ROUND') ? 'yes' : 'NO - FALLO')
second.ws.close()
await wait(500)
process.exit(0)
