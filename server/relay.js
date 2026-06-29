// Tiny WebSocket relay so a Mac (capture mode) can drive the iPad (display
// mode) over the local network. Run with `npm run relay`.
//
// Protocol:
//   client → server  {type:'hello', role:'capture'|'display'}
//   client → server  {type:'frame', payload:{...}}
//   server → other clients  {type:'frame', payload:{...}}

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });

console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);

const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  ws.role = 'unknown';
  const ip = req.socket.remoteAddress;
  console.log(`[relay] +client (${ip}) total=${clients.size}`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'hello') {
      ws.role = msg.role || 'unknown';
      console.log(`[relay] hello role=${ws.role} from ${ip}`);
      return;
    }
    if (msg.type === 'frame') {
      for (const c of clients) {
        if (c !== ws && c.readyState === 1) c.send(data);
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[relay] -client total=${clients.size}`);
  });
});
