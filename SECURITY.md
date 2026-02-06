# Security Guide

No internet app is perfectly unhackable. This project applies practical security controls for a small 1:1 video app.

## Current protections

- Strict room id validation and bounded payload sizes
- 1 host + 1 guest room limit
- Room expiry (default 24 hours)
- Rate limits for REST and WebSocket traffic
- JSON body size caps and WebSocket max payload caps
- Short-lived TURN credentials (when TURN shared secret is configured)
- Browser policies in `index.html` (CSP, referrer policy, permissions policy)
- Advanced packet mode encryption controls remain in this repo for the hidden route

## Backend security checklist

- Keep Node and dependencies patched
- Use Fly secrets for `TURN_SHARED_SECRET` and other sensitive values
- Lock down `CORS_ORIGINS` to your frontend URL
- Set `FRONTEND_BASE_URL` correctly so generated links are trusted
- Rotate TURN shared secret if compromise is suspected

## TURN relay checklist

- Keep coturn image updated
- Use the same shared secret between backend and coturn
- Use a proper realm and domain
- Restrict unnecessary open ports

## User safety checklist

- Share links privately
- Do not reuse the same room link for sensitive calls
- End and recreate links after a call
- Prefer trusted networks

## Incident response basics

- Rotate secrets immediately if compromise is suspected
- Revoke affected credentials/tokens
- Redeploy patched builds and invalidate old links where possible
- Inform users quickly with clear impact notes
