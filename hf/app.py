"""Hugging Face Space entry — SmartMirror API on port 7860."""

from __future__ import annotations

from fastapi.responses import HTMLResponse

from services.api.app.main import app

__all__ = ["app"]


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def space_home() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>SmartMirror</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0;
           min-height: 100vh; display: grid; place-items: center;
           background: radial-gradient(1200px 600px at 20% 0%, #1e293b 0%, #0f172a 55%, #020617 100%);
           color: #e2e8f0; }
    main { max-width: 36rem; padding: 2rem; }
    h1 { font-size: 2rem; letter-spacing: -0.03em; margin: 0 0 0.5rem; }
    p { line-height: 1.5; color: #94a3b8; }
    a { color: #7dd3fc; }
    ul { padding-left: 1.2rem; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <h1>SmartMirror</h1>
    <p>AI wardrobe stylist and virtual try-on API. Open the interactive docs to try the routes.</p>
    <ul>
      <li><a href="/docs">OpenAPI docs</a></li>
      <li><a href="/health">Health</a></li>
      <li><a href="/v1/capabilities">Capabilities</a></li>
    </ul>
  </main>
</body>
</html>
"""
