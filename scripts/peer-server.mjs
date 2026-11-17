// Lokaler PeerJS-Vermittlungsdienst für Entwicklung und Tests (ohne Internet).
// Start: npm run dev:peer  ·  Client bauen mit VITE_PEER_HOST=localhost VITE_PEER_PORT=9000 VITE_PEER_SECURE=false
import { createServer } from 'node:http';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const port = Number(process.env.PORT ?? 9000);
const host = process.env.HOST ?? '127.0.0.1';
const app = express();
const server = createServer(app);
app.use('/', ExpressPeerServer(server, { path: '/', allow_discovery: false }));
server.listen(port, host, () => console.log(`PeerJS-Server läuft auf http://${host}:${port}/`));
