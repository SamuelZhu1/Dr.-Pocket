import pandas as pd
import numpy as np
from PIL import Image
from pathlib import Path
from typing import Optional

import torch
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from sklearn.model_selection import train_test_split

import config


class HAM10000Dataset(Dataset):
    def __init__(self, df: pd.DataFrame, transform=None):
        self.df = df.reset_index(drop=True)
        self.transform = transform
        self.class_to_idx = {c: i for i, c in enumerate(config.CLASS_NAMES)}

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        image = Image.open(row["path"]).convert("RGB")
        if self.transform:
            image = self.transform(image)
        label = self.class_to_idx[row["dx"]]
        return image, label


def _find_image(image_id: str, data_dir: Path) -> Optional[Path]:
    for folder in ["HAM10000_images_part_1", "HAM10000_images_part_2", "images"]:
        p = data_dir / folder / f"{image_id}.jpg"
        if p.exists():
            return p
    # flat layout fallback
    p = data_dir / f"{image_id}.jpg"
    if p.exists():
        return p
    return None


def build_splits(
    data_dir: Path = config.DATA_DIR,
    val_frac: float = 0.15,
    test_frac: float = 0.15,
    seed: int = 42,
):
    meta = pd.read_csv(data_dir / "HAM10000_metadata.csv")
    meta["path"] = meta["image_id"].apply(lambda x: _find_image(x, data_dir))
    meta = meta.dropna(subset=["path"])

    # Split on lesion_id, not image_id, to prevent the same lesion appearing in
    # both train and val (HAM10000 has multiple images per lesion).
    lesion_dx = meta.groupby("lesion_id")["dx"].first().reset_index()

    train_ids, temp_ids = train_test_split(
        lesion_dx["lesion_id"],
        test_size=val_frac + test_frac,
        stratify=lesion_dx["dx"],
        random_state=seed,
    )
    val_ids, test_ids = train_test_split(
        temp_ids,
        test_size=test_frac / (val_frac + test_frac),
        stratify=lesion_dx.set_index("lesion_id").loc[temp_ids]["dx"],
        random_state=seed,
    )

    train_df = meta[meta["lesion_id"].isin(train_ids)]
    val_df   = meta[meta["lesion_id"].isin(val_ids)]
    test_df  = meta[meta["lesion_id"].isin(test_ids)]
    return train_df, val_df, test_df


def get_transforms(train: bool = True):
    if train:
        return transforms.Compose([
            transforms.RandomResizedCrop(config.IMG_SIZE, scale=(0.75, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(),
            transforms.RandomRotation(30),
            transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.1),
            transforms.ToTensor(),
            transforms.Normalize(config.MEAN, config.STD),
        ])
    return transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(config.IMG_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(config.MEAN, config.STD),
    ])


def _make_sampler(df: pd.DataFrame) -> WeightedRandomSampler:
    class_to_idx = {c: i for i, c in enumerate(config.CLASS_NAMES)}
    labels = df["dx"].map(class_to_idx).values
    counts = np.bincount(labels, minlength=config.NUM_CLASSES).astype(float)
    class_weights = 1.0 / np.where(counts == 0, 1.0, counts)
    sample_weights = class_weights[labels]
    return WeightedRandomSampler(sample_weights, num_samples=len(sample_weights), replacement=True)


def get_loaders(data_dir: Path = config.DATA_DIR):
    train_df, val_df, test_df = build_splits(data_dir)

    train_ds = HAM10000Dataset(train_df, transform=get_transforms(train=True))
    val_ds   = HAM10000Dataset(val_df,   transform=get_transforms(train=False))
    test_ds  = HAM10000Dataset(test_df,  transform=get_transforms(train=False))

    loader_kwargs = dict(num_workers=config.NUM_WORKERS, pin_memory=False)
    train_loader = DataLoader(train_ds, batch_size=config.BATCH_SIZE,
                              sampler=_make_sampler(train_df), **loader_kwargs)
    val_loader   = DataLoader(val_ds,   batch_size=config.BATCH_SIZE,
                              shuffle=False, **loader_kwargs)
    test_loader  = DataLoader(test_ds,  batch_size=config.BATCH_SIZE,
                              shuffle=False, **loader_kwargs)

    return train_loader, val_loader, test_loader, train_df
