# Signaling Backend

This service provides:
- room creation (`POST /v1/rooms`)
- room status lookup (`GET /v1/rooms/:roomId`)
- TURN credential minting (`POST /v1/turn-credentials`)
- WebSocket signaling (`GET /v1/ws?roomId=...&peerId=...&role=host|guest`)

## Local run

```bash
npm install
npm run backend:dev
```

Default server URL is `http://127.0.0.1:8787`.

## Environment variables

- `PORT` default `8787`
- `HOST` default `0.0.0.0`
- `FRONTEND_BASE_URL` default `http://127.0.0.1:4173`
- `ROOM_TTL_SECONDS` default `86400`
- `TURN_URLS` comma-separated list, default `stun:stun.l.google.com:19302`
- `TURN_SHARED_SECRET` empty by default (required for real TURN auth)
- `TURN_TTL_SECONDS` default `600`
- `CORS_ORIGINS` comma-separated allowed origins (defaults to `FRONTEND_BASE_URL`)

## Fly deploy

1. Set app name in `backend/fly.toml`.
2. Set secrets:
   - `TURN_SHARED_SECRET`
   - `TURN_URLS`
   - `CORS_ORIGINS`
   - `FRONTEND_BASE_URL`
3. Deploy:

```bash
cd backend
fly launch --no-deploy
fly deploy
```
