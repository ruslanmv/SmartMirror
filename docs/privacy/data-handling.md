# Sensitive Media and Privacy

## Data classes

### Wardrobe media
Persistent until user deletion unless configured otherwise.

### Body captures
Sensitive media. Default retention should be short and explicit.

### Generated previews
Derived sensitive media. Default retention should be configurable and visible to the user.

### OllaBridge relay/media copy
Transport artifact only. Do not treat it as the authoritative SmartMirror media store.

## Rules

- Keep object storage private.
- Use expiring signed URLs.
- Store metadata in PostgreSQL, binary media in object storage.
- Never log image bytes or Base64 payloads.
- Record consent/purpose for retained body captures.
- Provide deletion that removes DB records and storage objects.
- Do not infer sensitive attributes such as health, religion, race, sexual orientation or pregnancy from body photos.

## Product safety

Fashion requests may include terms such as sexy/evening. Production image generation must still reject explicit nudity, non-consensual intimate imagery, and sexualized-minor content.
