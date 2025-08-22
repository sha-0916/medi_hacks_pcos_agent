# src/assistant.py
import os
from typing import List, Dict, Any
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def bullets(items: List[Dict[str, Any]]) -> str:
    lines = []
    for it in items[:5]:
        tag = it.get("tag") or it.get("symptom") or "Note"
        sug = (it.get("suggestion") or "").strip()
        src = (it.get("source") or "").strip()
        if not sug:
            continue
        lines.append(f"• {sug}" + (f" ({src})" if src else ""))
    return "\n".join(lines) if lines else "• Provide general education about PCOS and lifestyle. (Guideline 2023)"

def build_prompt(risk: str, prob_pcos: float, symptoms: List[str], evidence_text: str) -> str:
    symptoms_csv = ", ".join(symptoms) if symptoms else "none reported"
    return f"""System:
You are a careful health assistant. You DO NOT diagnose. You provide education and next-step suggestions grounded in the supplied evidence. If red-flag symptoms are present, advise urgent care. Keep answers under 180 words. Use plain language. Cite sources in-line like (Guideline 2023).

User facts (structured):
- PCOS risk band: {risk} (probability: {prob_pcos:.2f})
- Reported symptoms: {symptoms_csv}

Evidence snippets:
{evidence_text}

Instructions:
1) Briefly explain what this risk band means (screening estimate, not a diagnosis).
2) Give 3–5 next steps tailored to the symptoms and risk (what to monitor, which labs to discuss, when to see a clinician).
3) Include 1 short safety note about differentials and red-flag symptoms (e.g., severe pain, rapid virilization).
4) Be concise. No medication dosing or treatment plans.
"""

def call_llm(prompt: str) -> str:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=300,
    )
    return resp.choices[0].message.content.strip()
