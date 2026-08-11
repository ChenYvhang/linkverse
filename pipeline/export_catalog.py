"""Exports every category's product catalog (id/name/vector) and dimension
definitions to web/public/linkverse/catalog.json.

This is the one artifact the onboarding chat needs before any creator has
been collected, scored, or vision-analyzed: the "quick pick a known product"
tags in Onboarding.tsx render straight from it (product name + its hand-
defined vector, so clicking a tag re-scores creators without ever calling
DeepSeek), and the free-text chat sends it to /api/diagnose so DeepSeek can
place a visitor's product on the RIGHT category's axes instead of whichever
category's dataset happens to be loaded in the browser (see the comment in
web/api/diagnose.ts's buildVectorInstruction for the bug this replaced).

Deliberately independent of dataset.json (60MB+, gitignored, only exists
after the full pipeline has run): categories.yaml/dimensions.yaml/
products.yaml are checked-in config, so this runs cleanly on a fresh clone.

Run:
    python -m pipeline.export_catalog
"""
import json
from pathlib import Path

from pipeline.common import config
from pipeline.common.logging import get_logger

logger = get_logger("export_catalog")

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "web" / "public" / "linkverse" / "catalog.json"


def build_catalog() -> dict:
    catalog = {}
    for cat in config.list_categories():
        cid = cat["id"]
        dimensions = [
            {"key": d["key"], "name": d["name"], "description": d["description"]}
            for d in config.load_dimensions(cid)
        ]
        products = [
            {
                "id": p["id"],
                "name": p["name"],
                "description": p.get("description", ""),
                "vector": p["vector"],
            }
            for p in config.load_products(cid)
        ]
        catalog[cid] = {
            "label": cat["label_en"],
            "status": cat["status"],
            "dimensions": dimensions,
            "products": products,
        }
    return catalog


def run() -> None:
    catalog = build_catalog()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    n_products = sum(len(c["products"]) for c in catalog.values())
    logger.info("wrote %s: %d categories, %d products", OUTPUT_PATH, len(catalog), n_products)


if __name__ == "__main__":
    run()
