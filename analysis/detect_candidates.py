"""Blueprint Step D: robust median/MAD background, |z_robust| >= k on dHH or dHV, connected components,
minimum mapping unit, polygonize. z_robust is a relative anomaly score, not a probability."""
from __future__ import annotations

import math

import numpy as np
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import shape
from shapely.ops import unary_union

from analysis import config


def robust_background(delta: np.ndarray, valid: np.ndarray) -> dict:
    v = delta[valid & np.isfinite(delta)].astype(np.float64)
    if v.size == 0:
        return {"median": None, "mad": None, "n": 0}
    med = float(np.median(v))
    mad = float(np.median(np.abs(v - med)))
    return {"median": med, "mad": mad, "n": int(v.size)}


def z_robust(delta: np.ndarray, bg: dict, valid: np.ndarray) -> np.ndarray:
    z = np.full(delta.shape, np.nan, np.float32)
    if bg["mad"]:  # MAD == 0 means a degenerate background: no z-score, no candidates
        z[valid] = config.MAD_CONSTANT * (delta[valid] - bg["median"]) / bg["mad"]
    return z


def _filter(z: np.ndarray, valid: np.ndarray) -> np.ndarray:
    f = ndimage.median_filter(np.where(valid, z, 0), size=config.SPECKLE_FILTER_SIZE)
    return np.where(valid, f, np.nan).astype(np.float32)


def detect(layers: dict, valid: np.ndarray, transform, pixel_area_m2: float,
           k: float = config.K_ROBUST, mmu_ha: float = config.MMU_HA) -> dict:
    chans = [c for c in ("hh", "hv") if f"delta_{c}_db" in layers]
    bg, z = {}, {}
    for c in chans:
        bg[c] = robust_background(layers[f"delta_{c}_db"], valid)
        z[c] = z_robust(layers[f"delta_{c}_db"], bg[c], valid)
        if config.SPECKLE_FILTER:
            z[c] = _filter(z[c], valid)
    if "delta_ratio_db" in layers:
        bg["ratio"] = robust_background(layers["delta_ratio_db"], valid)

    cand = np.zeros(valid.shape, bool)
    for c in chans:
        with np.errstate(invalid="ignore"):
            cand |= np.abs(z[c]) >= k
    cand &= valid

    structure = np.ones((3, 3), bool) if config.CONNECTIVITY == 8 else None
    labels, n = ndimage.label(cand, structure=structure)
    mmu_px = max(1, math.ceil(mmu_ha * 1e4 / pixel_area_m2))
    sizes = np.bincount(labels.ravel(), minlength=n + 1)
    keep = [i for i in range(1, n + 1) if sizes[i] >= mmu_px]
    # Deterministic order: area descending, then first pixel in raster order.
    first = ndimage.minimum(np.arange(labels.size).reshape(labels.shape), labels, index=keep) if keep else []
    order = sorted(zip(keep, first), key=lambda t: (-sizes[t[0]], t[1]))

    relabel = np.zeros(n + 1, np.int32)
    for new, (old, _) in enumerate(order, start=1):
        relabel[old] = new
    kept = relabel[labels]
    geoms: dict[int, list] = {}
    for g, val in shapes(kept, mask=kept > 0, transform=transform, connectivity=8):
        geoms.setdefault(int(val), []).append(shape(g))
    regions = [{"index": i, "candidate_id": f"C-{i:03d}", "pixel_count": int(sizes[old]),
                "geometry_native": unary_union(geoms[i])} for i, (old, _) in enumerate(order, start=1)]
    return {"regions": regions, "labels": kept, "z": z, "background": bg, "candidate_pixels": int(cand.sum()),
            "components_total": int(n), "components_below_mmu": int(n - len(keep)), "mmu_pixels": mmu_px,
            "k": k, "mmu_ha": mmu_ha}
