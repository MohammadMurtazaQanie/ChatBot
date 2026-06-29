"""
YPS AI — PDF Knowledge Base Builder
====================================
Run this script ONCE locally before deploying to Vercel.
It reads all PDFs in the Sources/ folder and creates a knowledge/
directory with searchable JSON files (one per source category).

Requirements:
    pip install pdfplumber tqdm

Usage:
    python process_sources.py
"""

import os
import json
import re
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("ERROR: pdfplumber not installed. Run:  pip install pdfplumber tqdm")
    raise

try:
    from tqdm import tqdm
except ImportError:
    # tqdm is optional — fall back to a plain iterator
    def tqdm(iterable, **kwargs):
        desc = kwargs.get("desc", "")
        items = list(iterable)
        print(f"  Processing {len(items)} files: {desc}")
        return items

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SOURCES_DIR = Path("Sources")
OUTPUT_DIR  = Path("knowledge")

CHUNK_WORDS   = 600   # target words per chunk
CHUNK_OVERLAP = 100   # words of overlap between consecutive chunks
MIN_CHUNK     = 50    # discard chunks shorter than this

# Map each subfolder name → the key used in the knowledge/ output files
FOLDER_MAP = {
    "NAP & Strategies":          "nap-strategies",
    "Academic Research":         "academic-research",
    "Regional Org Documents":    "regional-org",
    "NGO & Civil Society":       "ngo-civil-society",
    "UN Publications":           "un-publications",
    "UN Resolutions & Frameworks": "un-resolutions",
}

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean_text(raw: str) -> str:
    """Strip non-printable characters and collapse whitespace."""
    if not raw:
        return ""
    text = re.sub(r"[^\x20-\x7E\xA0-￿\n]", " ", raw)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str) -> list[str]:
    """Split text into overlapping word-based chunks."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + CHUNK_WORDS])
        if len(chunk.split()) >= MIN_CHUNK:
            chunks.append(chunk)
        i += CHUNK_WORDS - CHUNK_OVERLAP
    return chunks


def pretty_name(stem: str) -> str:
    """Turn a filename stem into a readable title."""
    return re.sub(r"[-_]+", " ", stem).strip()

# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------

def extract_pdf(path: Path) -> str:
    """Return all text from a PDF, or empty string on failure."""
    try:
        pages = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages.append(clean_text(t))
        return " ".join(pages)
    except Exception as exc:
        print(f"    [WARN] Could not read {path.name}: {exc}")
        return ""


def process_folder(folder: Path, category_key: str, category_label: str) -> list[dict]:
    """Extract and chunk all PDFs in one category folder."""
    pdf_files = sorted(folder.glob("*.pdf"))
    if not pdf_files:
        print(f"  No PDFs found in {folder}")
        return []

    chunks_out = []
    for pdf_path in tqdm(pdf_files, desc=category_label[:40]):
        full_text = extract_pdf(pdf_path)
        if not full_text:
            continue

        for idx, chunk in enumerate(chunk_text(full_text)):
            chunks_out.append({
                "id":          f"{pdf_path.stem}_{idx}",
                "source":      pdf_path.name,
                "source_name": pretty_name(pdf_path.stem),
                "category":    category_label,
                "chunk_index": idx,
                "text":        chunk,
            })

    return chunks_out

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not SOURCES_DIR.exists():
        print(f"ERROR: Sources directory '{SOURCES_DIR}' not found.")
        print("Make sure you run this script from the ChatBot project root.")
        return

    OUTPUT_DIR.mkdir(exist_ok=True)

    summary = {}

    for folder_name, category_key in FOLDER_MAP.items():
        folder_path = SOURCES_DIR / folder_name
        if not folder_path.exists():
            print(f"\nSkipping '{folder_name}' — folder not found")
            continue

        print(f"\n{'='*55}")
        print(f"  {folder_name}")
        print(f"{'='*55}")

        chunks = process_folder(folder_path, category_key, folder_name)
        summary[category_key] = len(chunks)

        out_path = OUTPUT_DIR / f"{category_key}.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(chunks, fh, ensure_ascii=False, separators=(",", ":"))

        size_kb = out_path.stat().st_size // 1024
        print(f"  → {len(chunks)} chunks  ({size_kb} KB)  →  {out_path}")

    # Write a small index so the frontend knows what's available
    index = {
        "categories": summary,
        "total_chunks": sum(summary.values()),
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
    with open(OUTPUT_DIR / "index.json", "w") as fh:
        json.dump(index, fh, indent=2)

    print(f"\n{'='*55}")
    print(f"  Knowledge base ready in  {OUTPUT_DIR}/")
    print(f"  Categories : {len(summary)}")
    print(f"  Total chunks: {sum(summary.values())}")
    print(f"{'='*55}\n")
    print("Next step: commit the knowledge/ folder to your GitHub repo,")
    print("then deploy to Vercel and set your DEEPSEEK_API_KEY environment variable.")


if __name__ == "__main__":
    main()
