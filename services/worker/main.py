"""Background worker entry point.

The first scaffold persists try-on jobs but deliberately does not perform generation.
A later milestone will claim queued jobs and call the configured VirtualTryOnProvider.
"""


def main() -> None:
    print("SmartMirror worker scaffold: no generation provider configured yet.")


if __name__ == "__main__":
    main()
