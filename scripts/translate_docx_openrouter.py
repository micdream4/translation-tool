#!/usr/bin/env python3
import argparse
import json
import os
import re
import ssl
import time
import zipfile
from dataclasses import dataclass
from io import BytesIO
from html import unescape
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DOC_XML_PATH = "word/document.xml"
MAX_RETRIES = 3

CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")
CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
SHORT_CODE_RE = re.compile(r"^[A-Z0-9#%+_.\-/]{1,10}$")
UPPER_ABBR_RE = re.compile(r"^[A-Z]{2,}(?:[-/][A-Z0-9]{1,})*$")
ALNUM_CODE_RE = re.compile(r"^(?=.*\d)[A-Za-z0-9][A-Za-z0-9_\-/:+().#]*$")
PLACEHOLDER_RE = re.compile(r"^__[A-Z]+_\d+__$")
PLACEHOLDER_FRAGMENT_RE = re.compile(r"^(?:TKN|ID|FMT)_\d+__$", re.I)
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_\-/:+()#.]+")
XML_TEXT_NODE_RE = re.compile(r"(<(?:w:)?t\b[^>]*>)(.*?)(</(?:w:)?t>)", re.DOTALL)
UI_MARKED_TOKEN_RE = re.compile(
    r"[『「“\"'《【\[]\s*[A-Za-z][A-Za-z0-9 _\-/]{0,30}\s*[』」”\"'》】\]]"
)
UI_MARKER_EXTRACT_RE = re.compile(
    r"([『「“\"'《【\[])\s*([A-Za-z][A-Za-z0-9 _\-/]{0,30})\s*([』」”\"'》】\]])"
)
EN_WORD_GLUE_RE = re.compile(
    r"\b(on|in|to|for|with|by|of|and|or|the)(analyzer|interface|page|operation|maintenance|consumables|sample|collection|prepare|complete|range|work|itself|safety|manual|service|procedure)\b",
    re.I,
)
EN_EXACT_TOKEN_FIXES = [
    (re.compile(r"\bdisassemblethe\b", re.I), "disassemble the"),
    (re.compile(r"\bnecessary,\s*Wearprotective\b"), "necessary, Wear protective"),
    (re.compile(r"\bWearprotective\b"), "Wear protective"),
    (re.compile(r"\bGerman,French\b"), "German, French"),
    (re.compile(r"\bCellsAnalysis\b"), "Cells Analysis"),
    (re.compile(r"\bImmunochromatographyThe\b"), "Immunochromatography The"),
    (re.compile(r"\bInterface:Analyzer\b"), "Interface: Analyzer"),
    (re.compile(r"\bandperformmaintenance\b", re.I), "and perform maintenance"),
    (re.compile(r"\bSupplyRequirements\b"), "Supply Requirements"),
    (re.compile(r"\bConnectthe\b"), "Connect the"),
    (re.compile(r"\bintothe\b", re.I), "into the"),
    (re.compile(r"\bdCpowerinterface\b"), "DC power interface"),
    (re.compile(r"\bCompositionDescription\b"), "Composition Description"),
    (re.compile(r"\bRoutineImaging\b"), "Routine Imaging"),
    (re.compile(r"\bFluorescenceImage\b"), "Fluorescence Image"),
    (re.compile(r"\binstalled,setthe\b", re.I), "installed, set the"),
    (re.compile(r"\bpowerswitchto\b", re.I), "power switch to"),
    (re.compile(r"\btostart\b", re.I), "to start"),
    (re.compile(r"\b1\.3\.3Fluorescence\b"), "1.3.3 Fluorescence"),
    (re.compile(r"\b1\.5Cybersecurity\b"), "1.5 Cybersecurity"),
    (re.compile(r"\bA 4 Printer\b"), "A4 Printer"),
    (re.compile(r"\bA 4\b"), "A4"),
    (re.compile(r"\bAnalyzer dCpowerinterface\b"), "Analyzer DC power interface"),
    (re.compile(r"\bDCPower Interface\b"), "DC Power Interface"),
    (re.compile(r"\bDCInterface\b"), "DC Interface"),
    (re.compile(r"\bUSBInterface\b"), "USB Interface"),
    (re.compile(r"\busesLEDlight\b"), "uses LED light"),
    (re.compile(r"\bwithGB/T\b"), "with GB/T"),
    (re.compile(r"\bandGB/T\b"), "and GB/T"),
    (re.compile(r"\bprovidesUSBinterface\b"), "provides USB interface"),
    (re.compile(r"\bwithTCP/IPprotocol\b"), "with TCP/IP protocol"),
    (re.compile(r"\btheDCpower\b"), "the DC power"),
    (re.compile(r"\bCBCDetection\b"), "CBC Detection"),
    (re.compile(r"\bCBCSingle\b"), "CBC Single"),
    (re.compile(r"\bdisplayWBC\b"), "display WBC"),
    (re.compile(r"\btheRBCvolume\b"), "the RBC volume"),
    (re.compile(r"\bRBCVolume\b"), "RBC Volume"),
    (re.compile(r"\bCBCThe\b"), "CBC The"),
    (re.compile(r"\bCBCWill\b"), "CBC Will"),
    (re.compile(r"\bCBCtest\b"), "CBC test"),
    (re.compile(r"\busesCBCtest\b"), "uses CBC test"),
    (re.compile(r"\bPLTthe\b"), "PLT the"),
    (re.compile(r"\bPLTvolume\b"), "PLT volume"),
    (re.compile(r"\bPLTcell\b"), "PLT cell"),
    (re.compile(r"\bAIAnalysis\b"), "AI Analysis"),
    (re.compile(r"\bRETand\b"), "RET and"),
    (re.compile(r"\bforCBC QC\b"), "for CBC QC"),
    (re.compile(r"\binstrumentUSBinterface\b"), "instrument USB interface"),
    (re.compile(r"\baUUSB\b"), "a USB"),
    (re.compile(r"\btheUUSB\b"), "the USB"),
    (re.compile(r"\bcontainsImage\b"), "contains image"),
    (re.compile(r"\bUdisk\b"), "U disk"),
    (re.compile(r"\btheCBCunit\b"), "the CBC unit"),
    (re.compile(r"\bneededCBCthe\b"), "needed CBC the"),
    (re.compile(r"\btheCBCDefault/Adult\b"), "the CBC Default/Adult"),
    (re.compile(r"\btheCBCcalibration\b"), "the CBC calibration"),
    (re.compile(r"\btheCBCfive\b"), "the CBC five"),
    (re.compile(r"\btheWBC\b"), "the WBC"),
    (re.compile(r"\btheCBCdetection\b"), "the CBC detection"),
    (re.compile(r"\bCBCEnhanced\b"), "CBC Enhanced"),
    (re.compile(r"\bCBCTesting\b"), "CBC Testing"),
    (re.compile(r"\bPLTFocusing\b"), "PLT Focusing"),
]
ANALYZER_PREFIX_WORDS = [
    "after",
    "and",
    "away",
    "before",
    "by",
    "cause",
    "clean",
    "disassemble",
    "exceeds",
    "for",
    "from",
    "in",
    "into",
    "not",
    "notice",
    "of",
    "on",
    "onto",
    "or",
    "order",
    "the",
    "this",
    "to",
    "with",
]
ANALYZER_SUFFIX_WORDS = [
    "all",
    "any",
    "clean",
    "damage",
    "dcpowerinterface",
    "faults",
    "for",
    "housing",
    "interface",
    "is",
    "itself",
    "manual",
    "maintenance",
    "operation",
    "operations",
    "operational",
    "outer",
    "parts",
    "placed",
    "power",
    "powerswitch",
    "procedure",
    "procedures",
    "provides",
    "range",
    "rear",
    "reported",
    "requirements",
    "residual",
    "safety",
    "serial",
    "specified",
    "standard",
    "the",
    "when",
    "work",
]
ANALYZER_PREFIX_RE = re.compile(
    rf"\b({'|'.join(ANALYZER_PREFIX_WORDS)})(analyzer)(?=\b|[A-Za-z])",
    re.I,
)
ANALYZER_SUFFIX_RE = re.compile(
    rf"\b(analyzer)({'|'.join(ANALYZER_SUFFIX_WORDS)})\b",
    re.I,
)
ANALYZER_LOWERCASE_LEFT_RE = re.compile(
    rf"\b({'|'.join(ANALYZER_PREFIX_WORDS)})\s+Analyzer\b"
)


@dataclass
class Node:
    start: int
    end: int
    open_tag: str
    text: str
    close_tag: str


@dataclass
class ParagraphSegment:
    index: int
    text_nodes: List[ET.Element]

    @property
    def text(self) -> str:
        return "".join(node.text or "" for node in self.text_nodes)


def read_env(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def escape_xml_text(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def is_code_like(value: str) -> bool:
    text = normalize_ws(value)
    if not text:
        return True
    return bool(
        PLACEHOLDER_RE.match(text)
        or SHORT_CODE_RE.match(text)
        or UPPER_ABBR_RE.match(text)
        or ALNUM_CODE_RE.match(text)
    )


def should_translate(value: str, target_lang: str) -> bool:
    text = normalize_ws(value)
    if not text or is_code_like(text):
        return False

    has_cjk = bool(CHINESE_RE.search(text))
    has_cyr = bool(CYRILLIC_RE.search(text))
    target = target_lang.lower()

    if target == "english":
        return has_cjk or has_cyr
    # For non-English targets, we at least translate CJK/Cyrillic nodes.
    return has_cjk or has_cyr or bool(re.search(r"[A-Za-z]", text))


def guard_tokens(text: str) -> Tuple[str, Dict[str, str]]:
    placeholders: Dict[str, str] = {}
    counter = 0
    sanitized = text

    def protect_ui(match: re.Match) -> str:
        nonlocal counter
        token = match.group(0)
        ph = f"__ID_{counter}__"
        counter += 1
        placeholders[ph] = token
        return ph

    def repl(match: re.Match) -> str:
        nonlocal counter
        token = match.group(0)
        core = token.strip().strip("()[]{}.,:;")
        if not core:
            return token
        if PLACEHOLDER_FRAGMENT_RE.match(core):
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

    sanitized = UI_MARKED_TOKEN_RE.sub(protect_ui, sanitized)
    sanitized = TOKEN_RE.sub(repl, sanitized)
    return sanitized, placeholders


def restore_tokens(text: str, placeholders: Dict[str, str]) -> str:
    output = text
    for key, value in placeholders.items():
        match = re.match(r"^__([A-Z]+)_(\d+)__$", key, re.I)
        if match:
            pattern = re.compile(rf"_+(?:TKN|ID|FMT)_{re.escape(match.group(2))}_+", re.I)
        else:
            core = re.sub(r"^_+|_+$", "", key)
            if not core:
                continue
            pattern = re.compile(rf"_{{0,2}}{re.escape(core)}_{{0,2}}")
        output = pattern.sub(key, output)
    for key, value in placeholders.items():
        output = output.replace(key, value)
    return output


def preserve_ui_marker_symbols(original: str, translated: str) -> str:
    markers = [
        (f"{m.group(1)}{m.group(2)}{m.group(3)}", m.group(2).strip())
        for m in UI_MARKER_EXTRACT_RE.finditer(original or "")
    ]
    if not markers:
        return translated
    output = translated
    for full, label in markers:
        escaped = re.escape(label)
        any_wrapped = re.compile(
            rf"[『「“\"'《【\[]\s*{escaped}\s*[』」”\"'》】\]]",
            re.I,
        )
        output = any_wrapped.sub(full, output)
    return output


def lower_first(value: str) -> str:
    if not value:
        return value
    return value[:1].lower() + value[1:]


def post_fix_text(text: str, original: str, target_lang: str) -> str:
    output = text
    output = re.sub(r"\s+([,.;:!?])", r"\1", output)
    output = re.sub(r"([,.;!?])(?![\s\"')\]\}])", r"\1 ", output)
    output = re.sub(r":(?!//)(?![\s\"')\]\}])", ": ", output)
    output = re.sub(r"([.!?])([A-Z])", r"\1 \2", output)
    output = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", output)
    output = re.sub(r"([0-9])([A-Za-z])", r"\1 \2", output)
    output = re.sub(r"([A-Za-z])([0-9])", r"\1 \2", output)
    output = re.sub(r"\)\)+", ")", output)
    output = re.sub(r"\]\]+", "]", output)
    output = re.sub(r"\}\}+", "}", output)
    output = output.replace(").)", ").")
    if target_lang.lower() == "english":
        output = re.sub(r"\b([A-Z]{2,}\d*(?:/[A-Z]+)?)([A-Z][a-z]{2,})\b", r"\1 \2", output)
        output = re.sub(r"\b([A-Z]{2,}\d*)([a-z]{2,})\b", r"\1 \2", output)
        output = EN_WORD_GLUE_RE.sub(lambda m: f"{m.group(1)} {m.group(2)}", output)
        for pattern, replacement in EN_EXACT_TOKEN_FIXES:
            output = pattern.sub(replacement, output)
        for _ in range(3):
            next_output = ANALYZER_PREFIX_RE.sub(
                lambda m: f"{m.group(1)} {lower_first(m.group(2))}",
                output,
            )
            next_output = ANALYZER_SUFFIX_RE.sub(
                lambda m: f"{m.group(1)} {lower_first(m.group(2))}",
                next_output,
            )
            if next_output == output:
                break
            output = next_output
        output = ANALYZER_LOWERCASE_LEFT_RE.sub(lambda m: f"{m.group(1)} analyzer", output)
        output = re.sub(
            r"\b(analyzer)(the|specified|itself|safety|interface|range|operation|maintenance|manual|procedures?)\b",
            r"\1 \2",
            output,
            flags=re.I,
        )
        output = re.sub(r"\b(interface)(prepare)\b", r"\1 \2", output, flags=re.I)
        output = re.sub(r"\b(collection)(and)\b", r"\1 \2", output, flags=re.I)
        output = re.sub(r"\b(consumables),(?=[A-Za-z])", "consumables, ", output)
        output = re.sub(r"\b(complete)(sample)\b", r"\1 \2", output, flags=re.I)
        output = re.sub(
            r"\b(Hunan)\s+(Yi\s*Hong)(?=\s+Health\s+Technology)",
            r"\1 Ehome",
            output,
            flags=re.I,
        )
        output = re.sub(
            r"\bHunan\s+E[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b",
            "Hunan Ehome Health Technology Co., Ltd.",
            output,
            flags=re.I,
        )
        output = re.sub(
            r"\bHunan\s+Yi\s*Hong\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b",
            "Hunan Ehome Health Technology Co., Ltd.",
            output,
            flags=re.I,
        )
        output = re.sub(
            r"\bE[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b",
            "Ehome Health Technology Co., Ltd.",
            output,
            flags=re.I,
        )
    output = preserve_ui_marker_symbols(original, output)
    return output


def parse_nodes(xml_text: str) -> List[Node]:
    nodes: List[Node] = []
    for match in XML_TEXT_NODE_RE.finditer(xml_text):
        nodes.append(
            Node(
                start=match.start(),
                end=match.end(),
                open_tag=match.group(1),
                text=unescape(match.group(2)),
                close_tag=match.group(3),
            )
        )
    return nodes


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def register_namespaces(xml_bytes: bytes) -> None:
    for _, ns in ET.iterparse(BytesIO(xml_bytes), events=("start-ns",)):
        prefix, uri = ns
        ET.register_namespace(prefix or "", uri)


def parse_paragraph_segments(xml_bytes: bytes) -> Tuple[ET.ElementTree, List[ParagraphSegment]]:
    register_namespaces(xml_bytes)
    root = ET.fromstring(xml_bytes)
    tree = ET.ElementTree(root)
    segments: List[ParagraphSegment] = []
    index = 0
    for element in root.iter():
        if local_name(element.tag) != "p":
            continue
        text_nodes = [node for node in element.iter() if local_name(node.tag) == "t"]
        if not text_nodes:
            continue
        segments.append(ParagraphSegment(index=index, text_nodes=text_nodes))
        index += 1
    return tree, segments


def is_preferred_split_boundary(text: str, index: int) -> bool:
    if index <= 0 or index >= len(text):
        return False
    left = text[index - 1]
    right = text[index]
    if left.isspace() or right.isspace():
        return True
    if re.match(r"[,.;:!?)}\]]", left):
        return True
    if re.match(r"[({\['\"“‘]", right):
        return True
    return False


def adjust_split_index(text: str, desired: int, minimum: int, maximum: int) -> int:
    safe_min = max(0, minimum)
    safe_max = min(len(text), maximum)
    cut = min(max(desired, safe_min), safe_max)
    if is_preferred_split_boundary(text, cut):
        return cut
    for offset in range(1, 25):
        right = cut + offset
        if right < safe_max and is_preferred_split_boundary(text, right):
            return right
        left = cut - offset
        if left > safe_min and is_preferred_split_boundary(text, left):
            return left
    return cut


XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def set_segment_text(text_nodes: List[ET.Element], text: str) -> None:
    if not text_nodes:
        return
    if len(text_nodes) == 1:
        text_nodes[0].text = text
        if text[:1].isspace() or text[-1:].isspace():
            text_nodes[0].set(XML_SPACE, "preserve")
        return

    original_lengths = [len(node.text or "") for node in text_nodes]
    total_original = sum(original_lengths) or len(text_nodes)
    parts: List[str] = []
    previous_cut = 0
    consumed_original = 0

    for idx in range(len(text_nodes) - 1):
        consumed_original += original_lengths[idx]
        desired = round((consumed_original / total_original) * len(text))
        cut = adjust_split_index(text, desired, previous_cut, len(text))
        parts.append(text[previous_cut:cut])
        previous_cut = cut
    parts.append(text[previous_cut:])

    for node, part in zip(text_nodes, parts):
        node.text = part
        if part[:1].isspace() or part[-1:].isspace():
            node.set(XML_SPACE, "preserve")
        elif XML_SPACE in node.attrib:
            del node.attrib[XML_SPACE]


def build_prompt(records: List[Dict[str, str]], target_lang: str) -> str:
    return f"""
You are a senior medical-device manual translator. Translate every string in the JSON array into {target_lang}.

Rules:
- Translate all non-{target_lang} natural-language text fully into {target_lang}.
- Keep only true codes/model numbers/abbreviations unchanged (e.g., WBC, RBC, QC, MCH, MCV).
- Translate address/common nouns such as "Room", "Building", "Street", "District", "City", "Province" into {target_lang}; keep proper names transliterated or unchanged.
- Preserve numbers, measurement units, IDs, and placeholders exactly.
- If content is mixed code + text, keep the code and translate the descriptive text.
- Keep placeholders such as "__ID_0__" exactly unchanged.
- Do not invent or introduce new placeholders; only keep those that exist in the input content.
- Translate natural-language UI labels, button names, menu names, and page names into {target_lang}; keep only code-like UI tokens and abbreviations unchanged.
- Preserve original wrapper symbols around UI labels exactly (e.g., 『Next』, 『Back』, 【Home】); translate the text inside them when it is natural language and do not replace wrappers with straight quotes.
- Output must be valid JSON object: {{"records":[...]}} with same length and same keys.
- No markdown, no explanation.

INPUT:
{json.dumps(records, ensure_ascii=False)}
""".strip()


def request_openrouter(
    api_key: str,
    model: str,
    target_lang: str,
    records: List[Dict[str, str]],
) -> List[Dict[str, str]]:
    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "You translate medical POCT documents while preserving structure and placeholders.",
            },
            {"role": "user", "content": build_prompt(records, target_lang)},
        ],
    }
    request = Request(
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
    with urlopen(request, timeout=120, context=insecure_ctx) as response:
        raw = response.read().decode("utf-8")
    body = json.loads(raw)
    content = body["choices"][0]["message"]["content"]
    if isinstance(content, list):
        content = "\n".join(
            str(chunk.get("text") or chunk.get("content") or "") for chunk in content
        )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("OpenRouter returned empty content.")
    cleaned = content.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(cleaned)
    records_out = parsed.get("records")
    if not isinstance(records_out, list):
        raise RuntimeError("OpenRouter payload missing records list.")
    return records_out


def is_residual_source(text: str, target_lang: str) -> bool:
    target = target_lang.lower()
    if target == "english":
        return bool(CHINESE_RE.search(text) or CYRILLIC_RE.search(text))
    # Generic fallback: still treat CJK/Cyrillic as residual source.
    return bool(CHINESE_RE.search(text) or CYRILLIC_RE.search(text))


def translate_docx(
    input_path: Path,
    target_lang: str,
    batch_size: int,
    max_candidates: Optional[int],
    output_suffix: Optional[str],
    report_suffix: Optional[str],
) -> Tuple[Path, Path]:
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
        or "google/gemini-3-flash-preview"
    ).strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY missing.")

    with zipfile.ZipFile(input_path, "r") as zin:
        xml_bytes = zin.read(DOC_XML_PATH)
        tree, segments = parse_paragraph_segments(xml_bytes)
        selected: List[Tuple[int, str, Dict[str, str]]] = []
        for idx, segment in enumerate(segments):
            raw = segment.text or ""
            if not should_translate(raw, target_lang):
                continue
            sanitized, placeholders = guard_tokens(raw)
            selected.append((idx, sanitized, placeholders))

        total_candidates = len(selected)
        if max_candidates is not None and max_candidates > 0:
            selected = selected[:max_candidates]
        print(
            f"Total segments: {len(segments)} | candidates: {total_candidates} | this run: {len(selected)}"
        )

        translated_map: Dict[int, str] = {}
        for i in range(0, len(selected), batch_size):
            chunk = selected[i : i + batch_size]
            payload = [{"content": item[1]} for item in chunk]
            ok = False
            last_err = ""
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    out = request_openrouter(api_key, model, target_lang, payload)
                    if len(out) != len(payload):
                        raise RuntimeError(f"Length mismatch: {len(out)} != {len(payload)}")
                    for n, item in enumerate(chunk):
                        idx = item[0]
                        placeholders = item[2]
                        candidate = str(out[n].get("content", item[1]))
                        translated_map[idx] = post_fix_text(
                            restore_tokens(candidate, placeholders),
                            segments[idx].text or "",
                            target_lang,
                        )
                    ok = True
                    break
                except (
                    HTTPError,
                    URLError,
                    TimeoutError,
                    RuntimeError,
                    json.JSONDecodeError,
                ) as error:
                    last_err = str(error)
                    time.sleep(min(2 * attempt, 6))

            batch_no = i // batch_size + 1
            total_batches = (len(selected) + batch_size - 1) // batch_size
            if not ok:
                print(f"Batch {batch_no}/{total_batches} failed: {last_err}")
                for item in chunk:
                    translated_map[item[0]] = item[1]
            else:
                print(f"Batch {batch_no}/{total_batches} translated ({len(chunk)} segments)")

        residual_count = 0
        residual_samples: List[str] = []
        bracket_artifact_count = 0

        for idx, segment in enumerate(segments):
            out_text = translated_map.get(idx, segment.text)
            if is_residual_source(out_text, target_lang):
                residual_count += 1
                if len(residual_samples) < 12:
                    residual_samples.append(f"#{idx + 1}: {normalize_ws(out_text)[:140]}")
            if "))" in out_text or ").)" in out_text:
                bracket_artifact_count += 1
            set_segment_text(segment.text_nodes, out_text)
        new_xml = ET.tostring(tree.getroot(), encoding="utf-8", xml_declaration=True)

    stem = input_path.stem
    target_label = target_lang.replace(" ", "_")
    output_name = f"Translated_{target_label}_{stem}.docx"
    if output_suffix:
        output_name = f"Translated_{target_label}_{stem}_{output_suffix}.docx"
    output_path = input_path.parent / output_name

    with zipfile.ZipFile(input_path, "r") as zin, zipfile.ZipFile(
        output_path, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == DOC_XML_PATH:
                data = new_xml
            zout.writestr(item, data)

    report_name = f"Docx_Audit_{stem}_{target_label}.txt"
    if report_suffix:
        report_name = f"Docx_Audit_{stem}_{target_label}_{report_suffix}.txt"
    report_path = input_path.parent / report_name
    report_lines = [
        f"Input: {input_path}",
        f"Output: {output_path}",
        f"Target: {target_lang}",
        f"Total segments: {len(segments)}",
        f"Total translatable candidates: {total_candidates}",
        f"Candidates translated in this run: {len(selected)}",
        f"Potential residual source-language segments: {residual_count}",
        f"Bracket artifact segments: {bracket_artifact_count}",
        "",
        "Residual samples:",
    ] + residual_samples
    report_path.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Output written: {output_path}")
    print(f"Audit report: {report_path}")
    print(f"Potential residual source-language segments: {residual_count}")
    print(f"Bracket artifact segments: {bracket_artifact_count}")
    return output_path, report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Translate DOCX text nodes with OpenRouter.")
    parser.add_argument("input", help="Input .docx path")
    parser.add_argument("--target", default="English", help="Target language label")
    parser.add_argument("--batch-size", type=int, default=24, help="Batch size")
    parser.add_argument(
        "--max-candidates",
        type=int,
        default=None,
        help="Translate only first N candidate nodes (pilot run)",
    )
    parser.add_argument("--output-suffix", default=None, help="Extra suffix in output filename")
    parser.add_argument("--report-suffix", default=None, help="Extra suffix in report filename")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        print(f"Input not found: {input_path}")
        return 2
    if input_path.suffix.lower() != ".docx":
        print("Input must be a .docx file.")
        return 2

    translate_docx(
        input_path=input_path,
        target_lang=args.target,
        batch_size=max(1, args.batch_size),
        max_candidates=args.max_candidates,
        output_suffix=args.output_suffix,
        report_suffix=args.report_suffix,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
