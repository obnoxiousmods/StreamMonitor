#!/usr/bin/env python3
"""StreamMonitor entry point."""
import uvicorn

def main():
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(__import__("os").environ.get("PORT", "8060")),
        log_level="info",
    )

if __name__ == "__main__":
    main()
