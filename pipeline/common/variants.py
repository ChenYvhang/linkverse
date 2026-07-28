"""Field-name normalization for pipeline/decide.py's creative_variants output.

decide.py's DeepSeek call only validates variant *count* (>=2), not per-field
completeness or spelling, so a handful of the 351 cached decisions have typo'd
or misspelled field names for one or more variants (found while wiring up
pipeline/translate_variants.py — see cache/decisions/*.json for the raw
originals). Renaming on read here means the frontend and the translation
stage both see the canonical field names without editing the original cached
LLM output at rest.
"""

FIELD_ALIASES = {
    "script_dependency": "script_direction",
    "subtitle_highlight": "subtitle_highlights",
    "subtitle_highlightS": "subtitle_highlights",
    "target_platform_mote": "target_platform_note",
}


def normalize_variant(variant: dict) -> dict:
    variant = dict(variant)
    for bad_key, good_key in FIELD_ALIASES.items():
        if good_key not in variant and bad_key in variant:
            variant[good_key] = variant.pop(bad_key)
    # "target_platform_market" is an ambiguous merge of target_platform_note +
    # target_market — only remap it when target_platform_note is genuinely
    # absent, so we never clobber a correctly-named field that happens to
    # coexist with it.
    if "target_platform_note" not in variant and "target_platform_market" in variant:
        variant["target_platform_note"] = variant.pop("target_platform_market")
    return variant
