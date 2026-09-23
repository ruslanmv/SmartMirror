# Security Policy

SmartMirror handles wardrobe images and potentially full-body captures. Treat these as sensitive personal media.

## Reporting

Please report security issues privately to the repository owner rather than opening a public issue containing exploit details or personal data.

## Deployment rules

- Never expose PostgreSQL, MinIO, Redis, or the SmartMirror internal API directly to the public Internet.
- Remote access should enter through OllaBridge's authenticated owner-scoped relay.
- Do not commit `.env`, API keys, OllaBridge device tokens, HomePilot keys, generated body captures, or wardrobe media.
- Use short-lived URLs for media delivery.
- Avoid logging raw image bytes, Base64 images, credentials, or full sensitive prompts.
- Production deployments must replace the example MinIO credentials.
- Body captures must have explicit retention/deletion handling.

## Trust boundary

Echo/companion -> OllaBridge -> HomePilot -> SmartMirror is the expected remote trust path. SmartMirror should not implement its own public remote tunnel.
