# Security Guide

This app is built to reduce attack surface, but no internet app can be guaranteed "non-hackable."

## What is already protected in this app

- End-to-end encrypted signaling packets (`AES-GCM` + `PBKDF2` key derivation).
- Envelope integrity binding so packet metadata tampering is detected.
- Strict packet size and chunk limits to block oversized payload abuse.
- Strict input validation for room code, passphrase, SDP, and ICE candidate fields.
- Brute-force slowdown: repeated bad passphrase attempts trigger a temporary cooldown.
- Chat and data channel message size limits to reduce injection and memory abuse risk.
- Browser security policies in `index.html` (CSP, referrer policy, permissions policy).
- No server-side call infrastructure (no signaling server, no TURN relay in this build).

## Deployment host security checklist

- Keep macOS fully updated.
- Use FileVault full-disk encryption.
- Turn on firewall.
- Use a password manager and unique long passwords.
- Use MFA on GitHub and any hosting account.
- Keep Node, npm, and dependencies updated regularly.
- Never store secrets in git history.
- Review dependency advisories (`npm audit`) before releases.

## User/network safety checklist

- Use strong one-time room codes.
- Use strong one-time passphrases (14+ chars, mixed types).
- Regenerate packets if any packet leaks.
- Prefer trusted networks for calls.
- Do not share packet text in public chats.
- Export diagnostics only when needed, since logs can include call metadata.

## Incident response basics

- If compromise is suspected: rotate all credentials immediately.
- Revoke compromised sessions/tokens on hosting and git providers.
- Publish patched build and invalidate old deployment links if possible.
- Notify users of any known exposure clearly and quickly.
