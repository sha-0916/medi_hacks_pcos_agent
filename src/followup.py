# src/followup.py
import pandas as pd
from pathlib import Path
from typing import Dict, Any, List, Optional

CSV = Path(__file__).resolve().parents[1] / "data/followups.csv"
DF  = pd.read_csv(CSV)

def next_questions(risk: str, asked_ids: Optional[List[str]] = None, k: int = 1) -> List[Dict[str, Any]]:
    asked_ids = set(asked_ids or [])
    df = DF[DF["risk"].str.lower() == risk.lower()].copy()
    df = df[~df["question_id"].isin(asked_ids)]
    return df.head(k).to_dict(orient="records")

def apply_answer(qrow: Dict[str, Any], answer: str) -> Dict[str, Any]:
    ans = (answer or "").strip().lower()
    yes = ans in ["y", "yes", "true", "1"]
    tag = qrow["tag_if_yes"] if yes else qrow["tag_if_no"]
    sug = qrow["suggestion_if_yes"] if yes else qrow["suggestion_if_no"]
    src = qrow.get("source", "")
    return {"tag": tag, "suggestion": sug, "source": src, "answered_yes": yes}
