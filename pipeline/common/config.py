"""品类配置加载 —— 所有 Stage 共用。

一个「品类」(category) 是一个产品垂类（运动相机 / 防晒 / 补剂……），每个品类
拥有自己的一套语义空间：vision.py 给达人打分用的维度、score.py 算共振分时对
照的单品向量、collect.py 采集用的种子词。

之所以按品类切分而不是共用一套维度：共振分 R = cosine(content_vector,
product_vector)，两个向量必须落在同一坐标系里，而坐标系是垂类专属的 ——
「防抖需求强度」对运动相机是强信号，对防晒霜是噪音。

在此之前，五个 Stage 各自实现了一遍 load_products() / load_dimensions()，读的
都是写死的 config/*.yaml 路径。此模块把它们收敛成一处，并把品类作为参数。

调用方全部默认 DEFAULT_CATEGORY，所以不传 --category 时行为与重构前一致。
"""
from functools import lru_cache
from pathlib import Path

import yaml

CONFIG_ROOT = Path(__file__).resolve().parent.parent / "config"
REGISTRY_PATH = CONFIG_ROOT / "categories.yaml"
CATEGORIES_ROOT = CONFIG_ROOT / "categories"


class UnknownCategoryError(ValueError):
    """品类 id 不在注册表里 —— 错误信息直接列出可用值，省去翻配置。"""


@lru_cache(maxsize=1)
def _registry() -> dict:
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def default_category() -> str:
    return _registry()["default"]


def list_categories() -> list[dict]:
    """注册表里的全部品类（含 status），按声明顺序。"""
    return _registry()["categories"]


def category_ids() -> list[str]:
    return [c["id"] for c in list_categories()]


def resolve(category: str | None) -> str:
    """None -> 默认品类；未知 id -> 明确报错而不是让 open() 抛 FileNotFoundError。"""
    if category is None:
        return default_category()
    if category not in category_ids():
        raise UnknownCategoryError(
            f"unknown category {category!r}; available: {', '.join(category_ids())}"
        )
    return category


def category_meta(category: str | None = None) -> dict:
    cid = resolve(category)
    return next(c for c in list_categories() if c["id"] == cid)


def category_dir(category: str | None = None) -> Path:
    """注册表里有、但配置目录还没建，是新增品类时最容易踩的一步 —— 这里直接
    说清楚缺什么，而不是让 open() 抛一个只有路径的 FileNotFoundError。"""
    cid = resolve(category)
    d = CATEGORIES_ROOT / cid
    if not d.is_dir():
        raise UnknownCategoryError(
            f"category {cid!r} is registered in {REGISTRY_PATH.name} but has no config "
            f"directory at {d} — it needs dimensions.yaml, products.yaml and seeds.yaml"
        )
    return d


@lru_cache(maxsize=None)
def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_dimensions(category: str | None = None) -> list[dict]:
    """按 index 升序返回维度定义 —— content_vector 的分量顺序即此顺序。"""
    data = _load_yaml(category_dir(category) / "dimensions.yaml")
    return sorted(data["dimensions"], key=lambda d: d["index"])


def load_dimension_index(category: str | None = None) -> dict[str, int]:
    """{维度 key: 在 content_vector 中的下标}。"""
    return {d["key"]: d["index"] for d in load_dimensions(category)}


def load_vision_schema(category: str | None = None) -> dict:
    """视觉模型的人设与输出字段定义（见各品类 dimensions.yaml 的 vision 块）。"""
    return _load_yaml(category_dir(category) / "dimensions.yaml")["vision"]


def load_products(category: str | None = None) -> list[dict]:
    return _load_yaml(category_dir(category) / "products.yaml")["products"]


def load_competitor_keywords(category: str | None = None) -> list[str]:
    """Stage5 独家性风险规则用的竞品关键词 —— 同属品类知识（运动相机的竞品是
    GoPro/DJI，防晒霜完全是另一批品牌）。"""
    return _load_yaml(category_dir(category) / "products.yaml").get("competitor_keywords", [])


def load_seeds(category: str | None = None) -> list[dict]:
    return _load_yaml(category_dir(category) / "seeds.yaml")["seeds"]


def add_category_argument(parser) -> None:
    """给任意 Stage 的 argparse 挂上统一的 --category 选项。"""
    parser.add_argument(
        "--category",
        default=None,
        help=f"product category (default: {default_category()}); one of: {', '.join(category_ids())}",
    )
