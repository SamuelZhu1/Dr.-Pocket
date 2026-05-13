"""
FastAPI inference server.

Run:  uvicorn api:app --reload --port 8000

Endpoints:
  GET  /health        — liveness check, tells you if the model file exists
  POST /predict       — takes a base64 image, returns diagnosis JSON
  POST /predict/upload — takes a multipart image file (easier to test via curl/Postman)
"""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import io

import config
import predict as predictor

app = FastAPI(title="Dr. Pocket Skin Classifier", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock down to your frontend origin in production
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    image: str             # base64-encoded JPEG or PNG
    body_region: Optional[str] = None


class PredictResponse(BaseModel):
    condition: str
    condition_code: str
    confidence: float
    severity: str
    top3: list
    disclaimer: str
    body_region: Optional[str] = None


@app.get("/health")
def health():
    model_ready = Path(config.MODEL_PATH).exists()
    return {"status": "ok", "model_ready": model_ready}


@app.post("/predict", response_model=PredictResponse)
def predict_base64(req: PredictRequest):
    if not Path(config.MODEL_PATH).exists():
        raise HTTPException(
            status_code=503,
            detail="Model weights not found. Run python train.py first.",
        )
    try:
        result = predictor.predict_base64(req.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Prediction failed: {e}")

    if req.body_region:
        result["body_region"] = req.body_region
    return result


@app.post("/predict/upload", response_model=PredictResponse)
async def predict_upload(file: UploadFile = File(...), body_region: Optional[str] = None):
    if not Path(config.MODEL_PATH).exists():
        raise HTTPException(
            status_code=503,
            detail="Model weights not found. Run python train.py first.",
        )
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        result = predictor.predict_pil(image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Prediction failed: {e}")

    if body_region:
        result["body_region"] = body_region
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
