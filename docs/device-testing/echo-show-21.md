# Echo Show 21 Capability Probe

Do not assume privileged Echo hardware APIs. Record each test against the
physical device and its exact Fire OS build.

## How to run it

1. Build the shell against the deployment you want to test:
   `cd apps/echo-show && gradle :app:assembleDebug -PsmartmirrorWebUrl=https://<deployment>`.
2. Install it the way you intend to distribute it (record which: `adb install`,
   Amazon Appstore Live App Testing, …). Note whether the app shows up in the
   launcher and with its banner.
3. Pair the screen once (Settings → Connection) so the network rows can run.
4. Open **`/smartmirror/device-probe`** inside the shell (Camera test → *Full
   device probe*). It runs the automatic checks itself and asks for the rest:
   press ↑ ↓ ← → and OK on the remote, tap the screen, press *Start camera*,
   *Native capture*, *Test microphone*, *Upload test image*, then turn the
   screen off and on (suspend/resume).
5. Scan the **Report** QR code with your phone and copy the results below. The
   report includes the Fire OS build (`android.os.Build.DISPLAY`), the model and
   the WebView user agent.

The shell is a WebView around the web app, so the probe measures what the
product actually uses: WebView `getUserMedia` (granted to the app origin only)
and the shell's system-camera capture, not Camera2/CameraX directly. The shell
denies page microphone access by design; "n/a — NotAllowedError" is the
expected microphone result inside the shell (voice goes through Alexa).

## Results

Device: _model_ · Fire OS build: _build_ · Shell version: _x.y.z_ · Date: _yyyy-mm-dd_

| Test | Probe row | Result | Notes |
|---|---|---|---|
| App distribution/install | App install / launch | pending | |
| Full-screen launch | Full-screen launch | pending | |
| D-pad navigation | D-pad navigation | pending | |
| Touch MotionEvent | Touch events | pending | |
| Camera enumeration | Camera enumeration | pending | |
| CAMERA runtime permission | Camera permission | pending | |
| Camera preview | Camera preview | pending | |
| JPEG capture | JPEG capture (WebView) / Native capture | pending | |
| RECORD_AUDIO permission / recording | Microphone permission / recording | pending | |
| HTTPS to OllaBridge | HTTPS to OllaBridge | pending | |
| OllaBridge pairing | OllaBridge pairing | pending | |
| Mirror node listing | Mirror node listing | pending | |
| Media upload | Media upload to the PC | pending | |
| Suspend/resume | Suspend / resume | pending | |

Fallback acceptance:

- camera unavailable -> companion/network/uploaded-photo source;
- microphone unavailable -> companion/Alexa/text;
- touch unavailable -> remote/D-pad UI.
