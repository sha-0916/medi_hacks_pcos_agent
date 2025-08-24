import requests
from typing import List, Dict, Any

# Locked to local Ollama + phi3:mini
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL_NAME = "phi3:mini"

def bullets(items: List[Dict[str, Any]]) -> str:
    lines = []
    for it in items[:5]:
        sug = (it.get("suggestion") or "").strip()
        src = (it.get("source") or "").strip()
        if not sug:
            continue
        lines.append(f"• {sug}" + (f" ({src})" if src else ""))
    return "\n".join(lines) if lines else "• Provide general PCOS education and lifestyle guidance. (Guideline 2023)"

def build_prompt(risk: str, prob_pcos: float, symptoms: List[str], evidence_text: str) -> str:
    symptoms_csv = ", ".join(symptoms) if symptoms else "none reported"
    return f"""System:
You are a careful health assistant. You DO NOT diagnose. Provide education and next-step suggestions grounded in the supplied evidence. If red-flag symptoms are present, advise urgent care. Keep answers under 180 words. Use plain language. Cite sources like (Guideline 2023).

User facts (structured):
- PCOS risk band: {risk} (probability: {prob_pcos:.2f})
- Reported symptoms: {symptoms_csv}

Evidence snippets:
{evidence_text}

Instructions:
1) Explain what this risk band means (screening estimate, not a diagnosis).
2) Give 3–5 next steps tailored to the symptoms and risk (what to monitor, labs to discuss, when to see a clinician).
3) Include 1 brief safety note about red flags (severe pain, rapid virilization, pregnancy with acute symptoms).
4) Be concise. No medication dosing or treatment plans.
"""

def call_llm(prompt: str) -> str:
    r = requests.post(
        OLLAMA_URL,
        json={"model": MODEL_NAME, "prompt": prompt, "temperature": 0.2, "stream": False, "keep_alive": "10m"},
        timeout=180
    )
    r.raise_for_status()
    return (r.json().get("response") or "").strip()
