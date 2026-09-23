# SmartMirror Echo Show Client

Native Kotlin/Android client targeting API 28+.

Design constraints:

- D-pad/remote navigation is mandatory.
- Touch is enhancement-only.
- Built-in Echo camera/microphone access is experimental until verified on physical hardware.
- Camera input is abstracted so companion/network/upload fallback does not change backend contracts.
- Remote traffic goes to OllaBridge Cloud, not directly to a LAN HomePilot URL.

Build:

```bash
gradle :app:assembleDebug
```
