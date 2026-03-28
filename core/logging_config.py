"""Logging configuration — imported for side-effect at startup."""

from __future__ import annotations

import logging.config
import os
from pathlib import Path

_LOG_DIR = Path(__file__).parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

# ANSI colour codes for console output
_RESET = "\033[0m"
_COLORS = {
    "DEBUG": "\033[36m",  # cyan
    "INFO": "\033[32m",  # green
    "WARNING": "\033[33m",  # yellow
    "ERROR": "\033[31m",  # red
    "CRITICAL": "\033[1;31m",  # bold red
}


class _ColorFormatter(logging.Formatter):
    """Wrap the level name in ANSI colour codes for terminal output."""

    def format(self, record: logging.LogRecord) -> str:
        color = _COLORS.get(record.levelname, "")
        if color:
            record.levelname = f"{color}{record.levelname}{_RESET}"
        return super().format(record)


_FMT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "console": {
                "()": _ColorFormatter,
                "format": _FMT,
            },
            "file": {
                "format": _FMT,
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "console",
                "stream": "ext://sys.stderr",
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "formatter": "file",
                "filename": str(_LOG_DIR / "streammonitor.log"),
                "maxBytes": 10 * 1024 * 1024,  # 10 MB
                "backupCount": 5,
                "encoding": "utf-8",
            },
        },
        "root": {
            "level": os.environ.get("LOG_LEVEL", "INFO"),
            "handlers": ["console", "file"],
        },
        "loggers": {
            "uvicorn": {"level": "WARNING"},
            "httpx": {"level": "WARNING"},
        },
    }
)
