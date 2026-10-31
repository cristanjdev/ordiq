"""Machine learning package for faculty-subject fit and preference ranking."""

from engine.ml.recommender import (
    compute_text_similarity,
    recommend_faculty,
    train_fit_model,
)

__all__ = ["compute_text_similarity", "recommend_faculty", "train_fit_model"]
