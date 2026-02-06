# coturn Relay Service

This folder contains a Fly deployment setup for coturn.

## Required secrets

- `TURN_SHARED_SECRET`: must match backend `TURN_SHARED_SECRET`
- `TURN_REALM`: domain or short realm label for your relay

## Deploy

```bash
cd infra/coturn
fly launch --no-deploy
fly secrets set TURN_SHARED_SECRET=your-secret TURN_REALM=your-domain
fly deploy
```

## TURN URL example

Use this value in backend `TURN_URLS`:

`turn:p2p-video-turn.fly.dev:3478?transport=udp`
