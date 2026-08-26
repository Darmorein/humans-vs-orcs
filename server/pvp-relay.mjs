/**
 * Tiny WebSocket room relay for 1v1 PvP (no matchmaking).
 * Usage: node server/pvp-relay.mjs
 */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

const PORT = Number(process.env.PVP_PORT || 3333);

/** @typedef {{ seat: 0|1, connected: boolean, displayName: string, factionId: string, ready: boolean }} LobbySeat */
/** @typedef {{ id: string, clients: Map<import('ws').WebSocket, { seat: 0|1 }>, seats: [LobbySeat, LobbySeat] }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

function emptySeats() {
  return [
    {
      seat: 0,
      connected: false,
      displayName: 'Player 1',
      factionId: 'humans',
      ready: false,
    },
    {
      seat: 1,
      connected: false,
      displayName: 'Player 2',
      factionId: 'orcs',
      ready: false,
    },
  ];
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastLobby(room) {
  const msg = { type: 'lobby', seats: room.seats };
  for (const ws of room.clients.keys()) send(ws, msg);
}

function peerOf(room, ws) {
  for (const [other] of room.clients) {
    if (other !== ws) return other;
  }
  return null;
}

function leave(ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const meta = room.clients.get(ws);
  if (!meta) return;
  room.clients.delete(ws);
  room.seats[meta.seat].connected = false;
  room.seats[meta.seat].ready = false;
  const peer = peerOf(room, ws);
  if (peer) {
    send(peer, { type: 'peerLeft' });
    broadcastLobby(room);
  }
  if (room.clients.size === 0) rooms.delete(roomId);
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Humans vs Orcs PvP relay\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  /** @type {string | null} */
  let roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'create') {
      if (roomId) return;
      let id = code();
      while (rooms.has(id)) id = code();
      const room = {
        id,
        clients: new Map(),
        seats: emptySeats(),
      };
      room.seats[0].connected = true;
      room.seats[0].displayName = String(msg.displayName || 'Player 1').slice(0, 24);
      room.clients.set(ws, { seat: 0 });
      rooms.set(id, room);
      roomId = id;
      send(ws, { type: 'welcome', roomId: id, seat: 0, isHost: true });
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'join') {
      if (roomId) return;
      const id = String(msg.roomId || '')
        .trim()
        .toUpperCase();
      const room = rooms.get(id);
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      if (room.clients.size >= 2) {
        send(ws, { type: 'error', message: 'Room full' });
        return;
      }
      const seat = room.seats[0].connected ? 1 : 0;
      room.seats[seat].connected = true;
      room.seats[seat].displayName = String(msg.displayName || `Player ${seat + 1}`).slice(0, 24);
      room.seats[seat].ready = false;
      room.clients.set(ws, { seat });
      roomId = id;
      send(ws, { type: 'welcome', roomId: id, seat, isHost: seat === 0 });
      broadcastLobby(room);
      return;
    }

    if (!roomId) {
      send(ws, { type: 'error', message: 'Not in a room' });
      return;
    }
    const room = rooms.get(roomId);
    if (!room) return;
    const meta = room.clients.get(ws);
    if (!meta) return;
    const seat = meta.seat;

    if (msg.type === 'setFaction') {
      const f = msg.factionId === 'orcs' ? 'orcs' : 'humans';
      room.seats[seat].factionId = f;
      room.seats[seat].ready = false;
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'setReady') {
      room.seats[seat].ready = !!msg.ready;
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'requestStart') {
      if (seat !== 0) {
        send(ws, { type: 'error', message: 'Only host can start' });
        return;
      }
      const [a, b] = room.seats;
      if (!a.connected || !b.connected) {
        send(ws, { type: 'error', message: 'Need two players' });
        return;
      }
      if (!a.ready || !b.ready) {
        send(ws, { type: 'error', message: 'Both players must be ready' });
        return;
      }
      // Host client will pick fair seed and broadcast matchStart; ack ready gate only.
      send(ws, { type: 'lobby', seats: room.seats });
      return;
    }

    if (msg.type === 'matchStart' || msg.type === 'command' || msg.type === 'chat' || msg.type === 'hashSync') {
      const peer = peerOf(room, ws);
      if (!peer) return;
      if (msg.type === 'chat') {
        send(peer, { type: 'chat', text: String(msg.text || '').slice(0, 200), fromSeat: seat });
        return;
      }
      if (msg.type === 'matchStart') {
        // Reset ready so rematch needs new ready
        room.seats[0].ready = false;
        room.seats[1].ready = false;
        const payload = {
          type: 'matchStart',
          seed: Number(msg.seed) >>> 0 || 1,
          factions: [
            msg.factions?.[0] === 'orcs' ? 'orcs' : 'humans',
            msg.factions?.[1] === 'orcs' ? 'orcs' : 'humans',
          ],
        };
        send(ws, payload);
        send(peer, payload);
        return;
      }
      // command / hashSync — relay as-is
      send(peer, msg);
      return;
    }
  });

  ws.on('close', () => {
    if (roomId) leave(ws, roomId);
  });
});

server.listen(PORT, () => {
  console.log(`[PvP relay] ws://127.0.0.1:${PORT}`);
});
