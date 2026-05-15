from pathlib import Path

BASE_DIR  = Path(__file__).parent
DATA_DIR  = BASE_DIR / "data" / "Ham1000 Data"
MODEL_DIR = BASE_DIR / "models"
MODEL_PATH = MODEL_DIR / "skin_classifier.pth"

IMG_SIZE      = 224
BATCH_SIZE    = 64
NUM_WORKERS   = 0
EPOCHS        = 15
FREEZE_EPOCHS = 3    # train only the head for this many epochs before unfreezing backbone
LR_HEAD       = 1e-3
LR_FULL       = 1e-4

NUM_CLASSES = 7

# Alphabetical order — must stay consistent across all files
CLASS_NAMES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]

CLASS_LABELS = {
    "akiec": "Actinic Keratoses",
    "bcc":   "Basal Cell Carcinoma",
    "bkl":   "Benign Keratosis",
    "df":    "Dermatofibroma",
    "mel":   "Melanoma",
    "nv":    "Melanocytic Nevi",
    "vasc":  "Vascular Lesion",
}

SEVERITY = {
    "akiec": "moderate",
    "bcc":   "high",
    "bkl":   "low",
    "df":    "low",
    "mel":   "critical",
    "nv":    "low",
    "vasc":  "moderate",
}

# ImageNet stats (EfficientNet pretrained on ImageNet)
MEAN = [0.485, 0.456, 0.406]
STD  = [0.229, 0.224, 0.225]
