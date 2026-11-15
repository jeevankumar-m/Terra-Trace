"""Every tunable number in the TerraTrace pipeline lives here. See docs/METHODS.md."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AOI_DIR = DATA / "aoi"
RAW_DIR = DATA / "raw"
DERIVED_DIR = DATA / "derived"

METHOD_ID = "paired_gcov_temporal_backscatter_v1"
INTERPRETATION_LIMIT = "Radar-response candidate; cause not established"

# --- Data contract -----------------------------------------------------------
REQUIRED_BAND = "S"            # TerraTrace MVP contract: NISAR S-band (ISRO S-SAR) only
REQUIRED_PRODUCT = "GCOV"
FREQUENCY = "frequencyA"
# Mask codes per ISRO NISAR Product Format Doc v1.2.1 sec. GCOV grids/mask and JPL D-102274 sec 4.3.3:
#   0 = invalid / partially focused, 1..5 = valid (sub-swath number), 255 = fill (outside radar extent)
MASK_INVALID = 0
MASK_FILL = 255
MASK_VALID_MIN, MASK_VALID_MAX = 1, 5

# --- Pair QA -----------------------------------------------------------------
MIN_OVERLAP_FRACTION = 0.5     # share of AOI covered by both scene grids
MIN_COMMON_VALID_FRACTION = 0.3  # share of AOI pixels valid in both scenes (warn below)

# --- Radiometry --------------------------------------------------------------
APPLY_GAMMA_TO_SIGMA = False   # keep gamma0 for both dates; True applies rtcGammaToSigmaFactor to BOTH

# --- Candidate detection -----------------------------------------------------
K_ROBUST = 3.0                 # |z_robust| >= K on dHH or dHV marks a candidate pixel
MAD_CONSTANT = 0.6745          # z_robust = 0.6745 * (delta - median) / MAD
MULTILOOK_WINDOW = 5           # spatial multilook: NxN valid-weighted boxcar mean of LINEAR power, same for both
                               # dates, before dB (1 = off). Real S-band GCOV at 10 m: per-pixel delta MAD 2.9 dB -> 1.4/0.8 dB
SPECKLE_FILTER = False         # optional 3x3 median on the z-score layers before thresholding
SPECKLE_FILTER_SIZE = 3
CONNECTIVITY = 8
MMU_HA = 1.0                   # minimum mapping unit, hectares (converted with the real pixel area)

BACKGROUND_OFFSET_WARN_DB = 1.0  # |median delta| above this = scene-wide offset (calibration?) warning

# --- Pattern labels (median z of the candidate region) ------------------------
BACKGROUND_Z = 2.0             # |median z| below this = "inside background range"

# --- Evidence levels ----------------------------------------------------------
EVIDENCE_MIN_NEIGHBOURHOOD_VALID = 0.9   # valid share of the region dilated by EVIDENCE_DILATE_PX
EVIDENCE_DILATE_PX = 2
EVIDENCE_STRONG_SIZE_MMU = 5.0           # area >= 5 x MMU counts as spatially substantial
EVIDENCE_MIN_COMPACTNESS = 0.2           # Polsby-Popper 4*pi*A/P^2
# Without independent corroboration a candidate is capped at MEDIUM (HIGH is reserved).
HIGH_REQUIRES_CORROBORATION = True

# --- Display (stored in the manifest; the frontend never hard-codes ranges) ---
BACKSCATTER_PERCENTILES = (2, 98)   # joint stretch across Date A and Date B per channel
DELTA_RANGE_DB = 6.0                # symmetric +/- range for delta layers
