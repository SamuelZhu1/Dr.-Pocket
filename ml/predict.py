"""
Inference utilities — used by api.py.
Model is loaded once and cached in memory.
"""

import base64
import io
from pathlib import Path
from typing import Optional

import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms

import config
from model import load_model

_model = None
_device: Optional[str] = None


def _get_model():
    global _model, _device
    if _model is None:
        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = load_model(config.MODEL_PATH, device=_device)
    return _model, _device


_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(config.IMG_SIZE),
    transforms.ToTensor(),
    transforms.Normalize(config.MEAN, config.STD),
])


def predict_pil(image: Image.Image) -> dict:
    model, device = _get_model()
    tensor = _transform(image.convert("RGB")).unsqueeze(0).to(device)

    with torch.no_grad():
        probs = F.softmax(model(tensor), dim=1)[0].cpu().numpy()

    top3_idx = probs.argsort()[::-1][:3]
    top_code = config.CLASS_NAMES[top3_idx[0]]

    return {
        "condition":      config.CLASS_LABELS[top_code],
        "condition_code": top_code,
        "confidence":     float(probs[top3_idx[0]]),
        "severity":       config.SEVERITY[top_code],
        "top3": [
            {
                "label":       config.CLASS_LABELS[config.CLASS_NAMES[i]],
                "code":        config.CLASS_NAMES[i],
                "probability": float(probs[i]),
            }
            for i in top3_idx
        ],
        "disclaimer": (
            "This is an AI screening aid, not a clinical diagnosis. "
            "Always consult a qualified dermatologist."
        ),
    }


def predict_base64(b64_string: str) -> dict:
    image_bytes = base64.b64decode(b64_string)
    image = Image.open(io.BytesIO(image_bytes))
    return predict_pil(image)
