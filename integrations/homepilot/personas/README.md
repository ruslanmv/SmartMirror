# HomePilot persona templates

SmartMirror ships persona templates that the owner imports into their own
HomePilot. A persona is the owner's data: nothing here changes HomePilot code.

| Template | Package | Used by |
|---|---|---|
| **Stylist** (`stylist/`) | [`stylist.hpersona`](stylist.hpersona) | the mirror's stylist chat and voice answers |

## Install the Stylist on your HomePilot

1. **Import:** in HomePilot, open **Personas → Import**, choose `stylist.hpersona`,
   check the preview, and confirm. (API: `POST /persona/import/preview`, then
   `POST /persona/import`, both multipart with `file=@stylist.hpersona`.)
2. **Publish:** open the new **Stylist** persona → **Settings → Publish as API Model**,
   switch it on and set the alias to **`stylist`**.
   (API: `POST /projects/{project_id}/shared-api` with `{"enabled": true, "alias": "stylist"}`.)
   Imported personas are **not** published automatically, and unpublished personas
   are not visible to OllaBridge or the mirror.
3. **Check:** your HomePilot now lists a model named `persona:stylist--<id>` in
   `GET /v1/models`, and so does OllaBridge Cloud for your account. The mirror finds
   it by the `persona:stylist` prefix; you can pick another persona in the mirror's
   **Settings → Connection**.

## What the Stylist does

- Answers in at most three short, speakable sentences (it is read aloud on an Echo Show).
- When the mirror sends an **"Owned items"** block, it recommends only those items and
  says what is missing instead of inventing clothes.
- Never comments on body size or attractiveness; talks about clothes, colour, fit and occasion.
- Declares **no tools yet**. HomePilot pins declared tools on import, and the
  SmartMirror MCP tools reach HomePilot only in plan milestone M1b; a later version of
  this template will declare them. See [the upgrade plan](../../../docs/plans/homepilot-smartmirror-upgrade-plan.md).

## Edit and rebuild

The folder mirrors the `.hpersona` v2 layout (`manifest.json`, `blueprint/`,
`preview/`). After editing, rebuild the package:

```bash
make persona              # or: pnpm persona:build
```

The build is deterministic. CI (`tests/contracts/test_stylist_persona.py`) fails if the
committed package does not match its source, and, when a HomePilot checkout is available
(`HOMEPILOT_SRC`, default `../homepilot`), round-trips the package through HomePilot's own
preview and import code.
