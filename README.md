# Meet-Style 1:1 Video Calling

This app now uses a custom 1-to-1 call flow (no Jitsi embed).

## What it does

- One-click meeting link creation
- Join by full link or meeting code
- No account login required
- 1 host + 1 guest per room
- Custom signaling backend (WebSocket)
- TURN credentials endpoint for relay-ready setup
- In-call chat, mic/camera toggles, and screen share button
- Meet-inspired clean UI
- Advanced packet mode still exists at `#/advanced` (hidden from normal flow)

## Architecture

- Frontend: React + Vite (GitHub Pages ready)
- Backend: Node + TypeScript + WebSocket (`/backend`)
- Relay plan: coturn config in `/infra/coturn`

## API endpoints

- `POST /v1/rooms`
- `GET /v1/rooms/:roomId`
- `POST /v1/turn-credentials`
- `GET /v1/ws?roomId=...&peerId=...&role=host|guest`

## Local run

```bash
npm install
npm run backend:dev
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

Frontend default: `http://127.0.0.1:4173`
Backend default: `http://127.0.0.1:8787`

## Build

```bash
npm run build
npm run backend:build
```

## Tests

```bash
npm run test:unit
npm run test:backend
npm run test:integration
npm run test:e2e
npm run test:acceptance
```

## Deploy targets

- Frontend: GitHub Pages (`https://deveshpat.github.io/p2p-video-calling-secure/`)
- Backend: Fly (`/backend/fly.toml`)
- TURN relay: Fly coturn (`/infra/coturn`)

## Environment variables

### Frontend

- `VITE_API_BASE_URL` example: `https://your-fly-backend.fly.dev`

### Backend

- `PORT`
- `HOST`
- `FRONTEND_BASE_URL`
- `ROOM_TTL_SECONDS`
- `TURN_URLS`
- `TURN_SHARED_SECRET`
- `TURN_TTL_SECONDS`
- `CORS_ORIGINS`
