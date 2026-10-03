# SmartMirror Echo Show shell

A thin Android shell (API 28+) around the web UI in `apps/web`. It does not
re-implement screens; it hosts the Vercel deployment full-screen and bridges
only what a browser cannot reach.

```text
SmartMirrorEcho.apk
├── WebView  →  https://<deployment>/smartmirror
├── SmartMirrorBridge (window.SmartMirrorNative)
│   ├── getCapabilities()   camera / microphone / touch / dpad
│   ├── getDeviceInfo()
│   └── requestCapture(id)  system camera → JPEG data URL → SmartMirrorNativeCallback.resolve
├── D-pad → arrow keys (handled by the web app's spatial navigation)
└── Back  → WebView history, then exit
```

The JavaScript side of the contract lives in
`packages/device-capabilities/src/native-bridge.ts`.

Design constraints:

- D-pad/remote navigation is mandatory; touch is an enhancement.
- The page never gets raw camera/mic permission (`onPermissionRequest` denies);
  captures go through the bridge.
- The bridge only serves the configured SmartMirror origin; other links open
  outside the app.
- Pairing and every backend call go through the web app's BFF and OllaBridge.
  The APK holds no HomePilot or OllaBridge credential.

Pairing (show a code with a QR, or type a code with the remote) happens on the
web app's `/smartmirror/pairing` screen. The result is a sealed, HttpOnly
session cookie that the shell keeps in the WebView cookie store and flushes to
disk after every page load and on pause, so the screen stays paired across
restarts and power cuts; the web app renews it while the screen is in use. The
web app then lists the owner's nodes (`GET /v1/mirror/nodes` through the BFF),
remembers the HomePilot it uses, and shows "HomePilot offline" when that node
is down. No LAN address of the home PC is ever needed.

If the app itself cannot load (no Wi-Fi, deployment down), the shell shows a
full-screen notice, retries every 10 seconds, and retries at once on OK.

Build (point it at any Vercel deployment; needs the Android SDK, platform 35):

```bash
gradle :app:lintDebug :app:assembleDebug -PsmartmirrorWebUrl=https://smart-mirror.vercel.app
```

To check a physical device, open `/smartmirror/device-probe` inside the shell
and follow `docs/device-testing/echo-show-21.md`.
