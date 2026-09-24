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
`packages/device-capabilities/src/native-bridge.ts`, and the Vercel simulator
emulates it for the Echo profiles, so the same code path is tested without the
device.

Design constraints:

- D-pad/remote navigation is mandatory; touch is an enhancement.
- The page never gets raw camera/mic permission (`onPermissionRequest` denies);
  captures go through the bridge.
- The bridge only serves the configured SmartMirror origin; other links open
  outside the app.
- Pairing and every backend call go through the web app's BFF and OllaBridge.
  The APK holds no HomePilot or OllaBridge credential.

Build (point it at any Vercel preview):

```bash
gradle :app:assembleDebug -PsmartmirrorWebUrl=https://smart-mirror.vercel.app
```

`OllaBridgeApi.kt` / `OllaBridgeClient.kt` are kept for the native probe
milestone (`docs/device-testing/echo-show-21.md`); the shell itself does not use them.
