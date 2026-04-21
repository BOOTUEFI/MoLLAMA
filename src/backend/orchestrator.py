"""Mollama Orchestrator — intensity-based model routing.

Routing tiers:
  Tier 1 (Default)  — Qwen3.5: general coding, simple backend, all frontend
  Tier 2 (Logic)    — DeepSeek-V3.2: complex algorithms, deep debugging, level-5 logic
  Tier 3 (Context)  — MiniMax-M2.7: repo-wide refactors, tasks > 64k context
  Tier 4 (Prose)    — Gemma4:31b: documentation, non-technical writing, general knowledge

Falls back to whatever models are available if the preferred ones aren't pulled.
"""

import re
from typing import Optional
from pathlib import Path
import json

# Model family name patterns (match against available model names)
TIER_PATTERNS = {
    "deepseek": [r"deepseek", r"deepseek-v3"],
    "minimax": [r"minimax", r"minimax-m2", r"m2\.7"],
    "gemma4": [r"gemma4", r"gemma:4", r"gemma.*31b", r"gemma.*27b"],
    "qwen35": [r"qwen.*3\.5", r"qwen3\.5", r"qwen.*35b", r"qwen3:"],
}

# Cloud model pull names
PULL_MODELS = {
    "qwen35": "qwen3.5",
    "deepseek": "deepseek-v3",
    "minimax": "minimax-m2.7",
    "gemma4": "gemma4:31b",
}


def _load_settings() -> dict:
    f = Path("/data/settings.json")
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    return {}


def _orchestrator_enabled() -> bool:
    return _load_settings().get("orchestrator_enabled", False)


def _allowed_models() -> dict:
    settings = _load_settings()
    orch = settings.get("orchestrator_models", {})
    return {
        "qwen35": orch.get("qwen35", True),
        "deepseek": orch.get("deepseek", True),
        "minimax": orch.get("minimax", True),
        "gemma4": orch.get("gemma4", True),
    }


def _find_model(tier: str, available: list[str]) -> Optional[str]:
    """Find a model matching the given tier among available models."""
    patterns = TIER_PATTERNS.get(tier, [])
    for model in available:
        for pat in patterns:
            if re.search(pat, model, re.IGNORECASE):
                return model
    return None


def _score_task(messages: list[dict]) -> dict:
    """Determine task intensity and ideal routing tier."""
    # Grab the last user message
    text = ""
    ctx_chars = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            ctx_chars += len(content)
            if msg.get("role") == "user":
                text = content

    text_lower = text.lower()

    # Tier 3: high context (>48k chars ≈ 12k tokens)
    if ctx_chars > 48000:
        return {"tier": "minimax", "reason": "High context volume"}

    # Tier 2: complex logic/debugging
    logic_keywords = [
        "algorithm", "optimize", "debug", "refactor", "architecture",
        "performance", "complexity", "recursion", "concurrent", "deadlock",
        "race condition", "memory leak", "profil", "benchmark", "implement.*from scratch",
        "design pattern", "system design",
    ]
    if any(re.search(kw, text_lower) for kw in logic_keywords):
        return {"tier": "deepseek", "reason": "Complex logic/debugging task"}

    # Tier 4: prose/docs
    prose_keywords = [
        "write.*document", "docstring", "readme", "explain.*concept",
        "summarize", "summarise", "blog post", "essay", "write.*guide",
        "tutorial", "non-technical",
    ]
    if any(re.search(kw, text_lower) for kw in prose_keywords):
        return {"tier": "gemma4", "reason": "Prose/documentation task"}

    # Default: Tier 1
    return {"tier": "qwen35", "reason": "General task — default routing"}


def select_orchestrator_model(
    messages: list[dict],
    available_models: list[str],
) -> tuple[Optional[str], str]:
    """
    Returns (model_name, reason) based on task intensity.
    Returns (None, reason) if orchestrator is disabled or no match found.
    """
    if not _orchestrator_enabled():
        return None, "Orchestrator disabled"

    allowed = _allowed_models()
    score = _score_task(messages)
    tier = score["tier"]
    reason = score["reason"]

    # Try preferred tier first, then fall back through tiers
    tier_order = [tier, "qwen35", "deepseek", "minimax", "gemma4"]
    seen = set()
    for t in tier_order:
        if t in seen or not allowed.get(t, True):
            continue
        seen.add(t)
        model = _find_model(t, available_models)
        if model:
            return model, f"{reason} → {t}"

    return None, f"{reason} → no matching model available"


def escalate_on_failure(
    current_tier: str,
    available_models: list[str],
) -> Optional[str]:
    """Called when a task fails or produces poor output — escalate to next tier."""
    escalation = {"qwen35": "deepseek", "deepseek": "minimax"}
    next_tier = escalation.get(current_tier)
    if not next_tier:
        return None
    allowed = _allowed_models()
    if not allowed.get(next_tier, True):
        return None
    return _find_model(next_tier, available_models)
