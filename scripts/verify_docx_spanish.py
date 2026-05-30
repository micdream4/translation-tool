#!/usr/bin/env python3
import json
import os
import re
import ssl
import sys
import time
import zipfile
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DOC_XML_PATH = "word/document.xml"
BATCH_SIZE = 24
MAX_RETRIES = 3
TARGET_LANG = "Spanish"

CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
WORD_RE = re.compile(r"[A-Za-z]{3,}")
SHORT_CODE_RE = re.compile(r"^[A-Z0-9#%+_.\-/]{1,8}$")
UPPER_ABBR_RE = re.compile(r"^[A-Z]{2,}(?:[-/][A-Z0-9]{1,})*$")
ALNUM_CODE_RE = re.compile(r"^(?=.*\d)[A-Za-z0-9][A-Za-z0-9_\-/:+().#]*$")
PLACEHOLDER_RE = re.compile(r"^__[A-Z]+_\d+__$")
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_\-/:+()#.]+")
XML_TEXT_NODE_RE = re.compile(r"(<(?:w:)?t\b[^>]*>)(.*?)(</(?:w:)?t>)", re.DOTALL)

ALLOWED_EN_TOKENS = {
    "WBC",
    "RBC",
    "QC",
    "PLT",
    "CBC",
    "MCH",
    "MCHC",
    "MCV",
    "HCT",
    "HGB",
    "ALY",
    "IMHA",
    "LIS",
    "EDTA",
    "EHBT",
    "EHVT",
    "IVD",
    "SD",
    "CV",
}


@dataclass
class Node:
    start: int
    end: int
    open_tag: str
    text: str
    close_tag: str


def read_env(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip()
    return data


def escape_xml_text(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def should_translate(value: str) -> bool:
    text = normalize_ws(value)
    if not text:
        return False
    if PLACEHOLDER_RE.match(text):
        return False
    if SHORT_CODE_RE.match(text):
        return False
    if UPPER_ABBR_RE.match(text):
        return False
    if ALNUM_CODE_RE.match(text):
        return False
    return bool(CHINESE_RE.search(text) or LATIN_RE.search(text))


def guard_tokens(text: str) -> Tuple[str, Dict[str, str]]:
    placeholders: Dict[str, str] = {}
    counter = 0

    def repl(match: re.Match) -> str:
        nonlocal counter
        token = match.group(0)
        core = token.strip().strip("()[]{}.,:;")
        if not core:
            return token
        if not (
            PLACEHOLDER_RE.match(core)
            or UPPER_ABBR_RE.match(core)
            or ALNUM_CODE_RE.match(core)
        ):
            return token
        ph = f"__ID_{counter}__"
        counter += 1
        placeholders[ph] = token
        return ph

    sanitized = TOKEN_RE.sub(repl, text)
    return sanitized, placeholders


def restore_tokens(text: str, placeholders: Dict[str, str]) -> str:
    out = text
    for k, v in placeholders.items():
        out = out.replace(k, v)
    return out


def post_fix_text(text: str) -> str:
    out = text
    out = re.sub(r"\)\)+", ")", out)
    out = re.sub(r"\]\]+", "]", out)
    out = re.sub(r"\}\}+", "}", out)
    out = out.replace(").)", ").")
    return out


def parse_nodes(xml_text: str) -> List[Node]:
    nodes: List[Node] = []
    for m in XML_TEXT_NODE_RE.finditer(xml_text):
        nodes.append(
            Node(
                start=m.start(),
                end=m.end(),
                open_tag=m.group(1),
                text=unescape(m.group(2)),
                close_tag=m.group(3),
            )
        )
    return nodes


def build_prompt(records: List[Dict[str, str]]) -> str:
    return f"""
You are a senior hematology-manual translator. Convert every string within the JSON array to {TARGET_LANG} while maintaining fluent instructions.

Rules:
- Translate medical terminology fully into {TARGET_LANG}. Keep only true codes, model numbers, and standard abbreviations (e.g., WBC, RBC, QC) unchanged.
- Translate any non-{TARGET_LANG} natural-language text (including full English sentences) into {TARGET_LANG}.
- Translate address/common nouns such as "Room", "Building", "Street", "District", "City", "Province" into {TARGET_LANG}; keep only true proper names transliterated or unchanged.
- Preserve numbers, IDs, measurement units, and codes exactly.
- If a cell mixes code + text, keep the code intact and only translate the descriptive part.
- Keep placeholder tokens such as "__ID_0__" exactly as provided; they mark protected IDs/codes.
- Keep only true UI/code tokens unchanged (e.g., "Login", "admin", "START", product code literals). Do NOT keep full English prose unchanged.
- Optimize spacing and punctuation to read naturally in {TARGET_LANG}.
- Always return a valid JSON object: {{"records":[...]}} where records keeps the same length/keys. No explanations outside JSON.

INPUT:
{json.dumps(records, ensure_ascii=False)}
""".strip()


def request_openrouter(api_key: str, model: str, records: List[Dict[str, str]]) -> List[Dict[str, str]]:
    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "You translate medical POCT documents to the requested language while keeping structure unchanged.",
            },
            {"role": "user", "content": build_prompt(records)},
        ],
    }
    req = Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://poct-translator.local",
            "X-Title": "POCT Medical Translator",
        },
        method="POST",
    )
    # Local fallback for environments with broken CA bundles.
    insecure_ctx = ssl._create_unverified_context()
    with urlopen(req, timeout=120, context=insecure_ctx) as resp:
        raw = resp.read().decode("utf-8")
    body = json.loads(raw)
    content = body["choices"][0]["message"]["content"]
    if isinstance(content, list):
        content = "\n".join(str(chunk.get("text") or chunk.get("content") or "") for chunk in content)
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("OpenRouter returned empty content.")
    cleaned = content.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(cleaned)
    records_out = parsed.get("records")
    if not isinstance(records_out, list):
        raise RuntimeError("OpenRouter payload missing records list.")
    return records_out


def find_english_issues(text: str) -> bool:
    normalized = normalize_ws(text)
    if not normalized:
        return False
    if CHINESE_RE.search(normalized):
        return True
    words = WORD_RE.findall(normalized)
    if not words:
        return False
    bad: List[str] = []
    for w in words:
        upper = w.upper()
        if upper in ALLOWED_EN_TOKENS:
            continue
        if len(w) <= 2:
            continue
        bad.append(w)
    return len(bad) >= 2


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: verify_docx_spanish.py <docx-path>")
        return 2

    input_path = Path(sys.argv[1]).expanduser().resolve()
    if not input_path.exists():
        print(f"Input not found: {input_path}")
        return 2

    env = read_env(Path(".env.local"))
    api_key = (
        env.get("OPENROUTER_API_KEY")
        or os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("VITE_OPENROUTER_API_KEY")
        or ""
    ).strip()
    model = (
        env.get("OPENROUTER_MODEL")
        or os.environ.get("OPENROUTER_MODEL")
        or "qwen/qwen3.6-plus"
    ).strip()
    if not api_key:
        print("OPENROUTER_API_KEY missing.")
        return 2

    with zipfile.ZipFile(input_path, "r") as zin:
        xml_bytes = zin.read(DOC_XML_PATH)
        xml_text = xml_bytes.decode("utf-8")
        nodes = parse_nodes(xml_text)
        selected: List[Tuple[int, str, Dict[str, str]]] = []
        for idx, node in enumerate(nodes):
            raw = node.text or ""
            if not should_translate(raw):
                continue
            sanitized, placeholders = guard_tokens(raw)
            selected.append((idx, sanitized, placeholders))

        print(f"Total nodes: {len(nodes)} | candidates: {len(selected)}")
        translated_map: Dict[int, str] = {}
        for i in range(0, len(selected), BATCH_SIZE):
            chunk = selected[i : i + BATCH_SIZE]
            payload = [{"content": item[1]} for item in chunk]
            ok = False
            last_err = ""
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    out = request_openrouter(api_key, model, payload)
                    if len(out) != len(payload):
                        raise RuntimeError(f"Length mismatch: {len(out)} != {len(payload)}")
                    for n, item in enumerate(chunk):
                        idx = item[0]
                        placeholders = item[2]
                        candidate = str(out[n].get("content", item[1]))
                        translated_map[idx] = post_fix_text(
                            restore_tokens(candidate, placeholders)
                        )
                    ok = True
                    break
                except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as e:
                    last_err = str(e)
                    time.sleep(min(2 * attempt, 6))
            batch_no = i // BATCH_SIZE + 1
            total_batches = (len(selected) + BATCH_SIZE - 1) // BATCH_SIZE
            if not ok:
                print(f"Batch {batch_no}/{total_batches} failed: {last_err}")
                for item in chunk:
                    translated_map[item[0]] = item[1]
            else:
                print(f"Batch {batch_no}/{total_batches} translated ({len(chunk)} nodes)")

        rebuilt_parts: List[str] = []
        cursor = 0
        issue_count = 0
        issue_samples: List[str] = []

        for idx, node in enumerate(nodes):
            rebuilt_parts.append(xml_text[cursor : node.start])
            out_text = translated_map.get(idx, node.text)
            if find_english_issues(out_text):
                issue_count += 1
                if len(issue_samples) < 8:
                    issue_samples.append(f"#{idx+1}: {normalize_ws(out_text)[:120]}")
            replaced = f"{node.open_tag}{escape_xml_text(out_text)}{node.close_tag}"
            rebuilt_parts.append(replaced)
            cursor = node.end
        rebuilt_parts.append(xml_text[cursor:])
        new_xml = "".join(rebuilt_parts)

    stem = input_path.stem
    output_name = f"Translated_Spanish_{stem}.docx"
    output_path = input_path.parent / output_name

    with zipfile.ZipFile(input_path, "r") as zin, zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == DOC_XML_PATH:
                data = new_xml.encode("utf-8")
            zout.writestr(item, data)

    report_path = input_path.parent / f"Docx_Audit_{stem}_es.txt"
    report_lines = [
        f"Input: {input_path}",
        f"Output: {output_path}",
        f"Total nodes: {len(nodes)}",
        f"Translated candidates: {len(selected)}",
        f"Potential residual non-Spanish nodes: {issue_count}",
        "",
        "Samples:",
    ] + issue_samples
    report_path.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Output written: {output_path}")
    print(f"Audit report: {report_path}")
    print(f"Potential residual non-Spanish nodes: {issue_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
