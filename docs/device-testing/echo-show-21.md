# Echo Show 21 Capability Probe

Do not assume privileged Echo hardware APIs.

The `SmartMirrorProbe` milestone should record each test against the physical device and exact Fire OS build.

| Test | Result | Notes |
|---|---|---|
| App distribution/install | pending | |
| Full-screen launch | pending | |
| D-pad navigation | pending | |
| Touch MotionEvent | pending | |
| CameraManager camera enumeration | pending | |
| CAMERA runtime permission | pending | |
| Camera2 preview | pending | |
| CameraX preview | pending | |
| JPEG capture | pending | |
| RECORD_AUDIO permission | pending | |
| AudioRecord | pending | |
| HTTPS to OllaBridge | pending | |
| OllaBridge pairing | pending | |
| Mirror node listing | pending | |
| Media upload | pending | |
| Suspend/resume | pending | |

Fallback acceptance:

- camera unavailable -> companion/network/uploaded-photo source;
- microphone unavailable -> companion/Alexa/text;
- touch unavailable -> remote/D-pad UI.
