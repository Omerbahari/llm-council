"""Vercel Python entrypoint — exposes the FastAPI app for the serverless runtime."""

import os
import sys

# Make the repo root importable so we can reuse the existing backend package.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.main import app  # noqa: E402,F401  -- re-exported for Vercel
