"""
python train.py

Trains EfficientNet-B3 on HAM10000 in two stages:
  Stage 1 (FREEZE_EPOCHS): only the classifier head is updated — fast warm-up.
  Stage 2 (remaining epochs): full fine-tune at a lower LR with cosine decay.

Best checkpoint (by val balanced accuracy) is saved to models/skin_classifier.pth.
"""

import json
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from sklearn.metrics import balanced_accuracy_score, classification_report
import numpy as np

import config
from dataset import get_loaders
from model import SkinClassifier


def run_epoch(model, loader, criterion, optimizer, device, train: bool):
    model.train(train)
    total_loss = 0.0
    all_preds, all_labels = [], []

    with torch.set_grad_enabled(train):
        for imgs, labels in loader:
            imgs, labels = imgs.to(device), labels.to(device)
            logits = model(imgs)
            loss = criterion(logits, labels)

            if train:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()

            total_loss += loss.item() * len(labels)
            all_preds.extend(logits.argmax(1).cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

    avg_loss = total_loss / len(loader.dataset)
    bal_acc  = balanced_accuracy_score(all_labels, all_preds)
    return avg_loss, bal_acc, all_preds, all_labels


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    train_loader, val_loader, test_loader, train_df = get_loaders()

    # Class-weighted loss to further counteract HAM10000's heavy class imbalance
    counts = train_df["dx"].value_counts()
    weights = torch.tensor(
        [1.0 / counts.get(c, 1) for c in config.CLASS_NAMES], dtype=torch.float
    ).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    model = SkinClassifier().to(device)

    # Stage 1 — head only
    model.freeze_backbone()
    optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=config.LR_HEAD)
    scheduler = None

    best_val_acc = 0.0
    history = []

    for epoch in range(1, config.EPOCHS + 1):
        if epoch == config.FREEZE_EPOCHS + 1:
            print("\n--- Unfreezing backbone for full fine-tune ---\n")
            model.unfreeze_backbone()
            optimizer = AdamW(model.parameters(), lr=config.LR_FULL, weight_decay=1e-4)
            scheduler = CosineAnnealingLR(optimizer, T_max=config.EPOCHS - config.FREEZE_EPOCHS)

        train_loss, train_acc, _, _ = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        val_loss,   val_acc,   _, _ = run_epoch(model, val_loader,   criterion, optimizer, device, train=False)

        if scheduler:
            scheduler.step()

        log = (f"Epoch {epoch:02d}/{config.EPOCHS}  "
               f"train_loss={train_loss:.4f}  train_bal_acc={train_acc:.4f}  "
               f"val_loss={val_loss:.4f}  val_bal_acc={val_acc:.4f}")
        print(log)

        history.append({
            "epoch": epoch,
            "train_loss": train_loss, "train_acc": train_acc,
            "val_loss": val_loss,     "val_acc": val_acc,
        })

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), config.MODEL_PATH)
            print(f"  -> New best  val_bal_acc={best_val_acc:.4f}  saved to {config.MODEL_PATH}")

    # Final evaluation on held-out test set
    print("\n--- Test set evaluation ---")
    model.load_state_dict(torch.load(config.MODEL_PATH, map_location=device))
    _, test_acc, test_preds, test_labels = run_epoch(
        model, test_loader, criterion, optimizer, device, train=False
    )
    print(f"Test balanced accuracy: {test_acc:.4f}")
    print(classification_report(test_labels, test_preds, target_names=config.CLASS_NAMES))

    with open(config.MODEL_DIR / "history.json", "w") as f:
        json.dump(history, f, indent=2)

    print(f"\nDone. Best val balanced accuracy: {best_val_acc:.4f}")


if __name__ == "__main__":
    main()
