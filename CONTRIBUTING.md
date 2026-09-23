# Contributing

1. Create a focused branch from `main`.
2. Keep SmartMirror-specific logic in this repository.
3. Keep HomePilot changes generic and additive.
4. Keep OllaBridge changes transport-oriented and generic.
5. Add tests for every contract change.
6. Do not commit personal photographs or credentials.

Run before opening a PR:

```bash
pip install -e ".[dev]"
ruff check .
pytest
```

For Echo client changes:

```bash
cd apps/echo-show
gradle :app:assembleDebug
```
