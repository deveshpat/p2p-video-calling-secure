# Direct P2P Video Calling

This app is a browser-based, zero-backend, peer-to-peer video calling tool.

## What it does

- 1-to-1 calls only
- Manual packet exchange (copy/paste text and QR chunks)
- No signaling server, no STUN/TURN, no call backend
- Full HD target at start (`1080p @ 30fps`)
- Auto quality fallback when network quality drops
- In-call text chat
- Mic/camera controls
- Live call stats
- Full diagnostics log with peer-to-peer sync and JSON export

## How packet exchange works

1. Host creates an invite packet.
2. Host sends all packet chunks to joiner (text or QR chunks).
3. Joiner imports packet and creates answer packet.
4. Joiner sends answer packet chunks back.
5. Host imports answer packet and call connects (best effort internet).

## Local run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Tests

```bash
npm run test:unit
npm run test:integration
npm run test:acceptance
```

## Deployment

- GitHub Pages auto-deploy is configured in `.github/workflows/deploy-pages.yml`.
- On each push to `main`, GitHub Actions builds and deploys the app.
