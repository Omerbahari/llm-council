"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.4",
    "google/gemini-3.1-pro-preview",
    "anthropic/claude-opus-4.7",
    "x-ai/grok-4.20",
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "google/gemini-3.1-pro-preview"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage.
# On Vercel (read-only FS except /tmp), default to /tmp/conversations.
# Locally, default to data/conversations (persistent in the repo).
DATA_DIR = os.getenv(
    "DATA_DIR",
    "/tmp/conversations" if os.getenv("VERCEL") else "data/conversations",
)
