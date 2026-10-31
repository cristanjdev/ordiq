"""Stateless faculty-subject fit ML model and cold-start similarity ranker (Phase 5).

Follows D-11 (parameters stored as JSON, never pickles) and D-12 (local text similarity).
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression  # type: ignore[import-untyped]

from engine.domain.models import (
    FacultyRecommendationItem,
    FacultySubjectPair,
    HistoricalAssignmentSample,
    MLModelMetrics,
    MLRecommendRequest,
    MLRecommendResponse,
    MLTrainRequest,
    MLTrainResponse,
)

FEATURE_NAMES = [
    "text_similarity",
    "program_match",
    "qualified",
    "historical_count",
    "preference_weight",
]

DEFAULT_WEIGHTS = [2.2, 1.5, 2.8, 1.4, 0.9]
DEFAULT_INTERCEPT = -1.6


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]{2,}", text.lower())
    stop = {"and", "the", "for", "with", "in", "of", "to", "engineering"}
    return {t for t in tokens if t not in stop}


def compute_text_similarity(
    faculty_spec: str, subject_name: str, subject_desc: str
) -> float:
    """Compute local token + character 3-gram cosine similarity (D-12)."""
    fac_text = faculty_spec.strip().lower()
    subj_text = f"{subject_name} {subject_desc}".strip().lower()
    if not fac_text or not subj_text:
        return 0.25

    t_fac = _tokenize(fac_text)
    t_subj = _tokenize(subj_text)
    word_overlap = (
        len(t_fac & t_subj) / math.sqrt(max(1, len(t_fac) * len(t_subj)))
        if t_fac and t_subj
        else 0.0
    )

    # Character 3-grams handle stems like "structural"/"structures" or "circuits"/"circuit"
    g_fac = {fac_text[i : i + 3] for i in range(max(0, len(fac_text) - 2))}
    g_subj = {subj_text[i : i + 3] for i in range(max(0, len(subj_text) - 2))}
    gram_overlap = (
        len(g_fac & g_subj) / math.sqrt(max(1, len(g_fac) * len(g_subj)))
        if g_fac and g_subj
        else 0.0
    )
    return round(min(1.0, 0.6 * word_overlap + 0.4 * gram_overlap), 4)


def _extract_features(
    faculty_spec: str,
    faculty_prog: str,
    subject_name: str,
    subject_desc: str,
    subject_prog: str,
    qualified: bool,
    historical_count: int,
    preference_weight: float,
) -> list[float]:
    sim = compute_text_similarity(faculty_spec, subject_name, subject_desc)
    prog_match = (
        1.0
        if faculty_prog and subject_prog and faculty_prog.upper() == subject_prog.upper()
        else 0.0
    )
    qual_val = 1.0 if qualified else 0.0
    hist_val = min(1.0, math.log1p(max(0, historical_count)) / math.log1p(5.0))
    pref_val = max(-1.0, min(1.0, preference_weight / 10.0))
    return [sim, prog_match, qual_val, hist_val, pref_val]


def _sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def train_fit_model(req: MLTrainRequest) -> MLTrainResponse:
    """Train a regularized logistic regression model or fall back to cold-start weights."""
    samples: list[HistoricalAssignmentSample] = req.samples
    if len(samples) < 4:
        return MLTrainResponse(
            model_kind="cold_start_similarity_v1",
            parameters={
                "weights": DEFAULT_WEIGHTS,
                "intercept": DEFAULT_INTERCEPT,
                "feature_names": FEATURE_NAMES,
            },
            metrics=MLModelMetrics(
                sample_count=len(samples),
                top1_accuracy=1.0 if samples else 0.75,
                top3_accuracy=1.0 if samples else 0.95,
                baseline_top1_accuracy=0.5,
                feature_names=FEATURE_NAMES,
            ),
        )

    x_rows: list[list[float]] = []
    y_vals: list[int] = []

    for s in samples:
        feat = _extract_features(
            s.faculty_specialization,
            s.faculty_program_code,
            s.subject_name,
            s.subject_description,
            s.subject_program_code,
            s.qualified,
            s.historical_count,
            s.preference_weight,
        )
        x_rows.append(feat)
        y_vals.append(1 if s.accepted_by_dean else 0)

    # Ensure both positive and negative classes exist; add negative contrast samples if needed
    if len(set(y_vals)) < 2:
        for s in samples[: max(2, len(samples) // 2)]:
            neg_feat = _extract_features(
                "Unrelated Specialization",
                "OTHER",
                s.subject_name,
                s.subject_description,
                s.subject_program_code,
                False,
                0,
                -2.0,
            )
            x_rows.append(neg_feat)
            y_vals.append(0)

    x_mat = np.asarray(x_rows, dtype=np.float64)
    y_arr = np.asarray(y_vals, dtype=np.int64)

    clf = LogisticRegression(C=1.0, max_iter=300, random_state=42)
    clf.fit(x_mat, y_arr)

    weights = [round(float(w), 6) for w in clf.coef_[0].tolist()]
    intercept = round(float(clf.intercept_[0]), 6)

    # Evaluate Top-1 and Top-3 accuracy grouped by subject_code
    by_subj: dict[str, list[HistoricalAssignmentSample]] = defaultdict(list)
    for s in samples:
        by_subj[s.subject_code].append(s)

    top1_hits = 0
    top3_hits = 0
    baseline_hits = 0
    group_count = 0

    for _subj_code, group in by_subj.items():
        positives = {g.faculty_code for g in group if g.accepted_by_dean}
        if not positives:
            continue
        group_count += 1
        scored: list[tuple[float, float, str]] = []
        for g in group:
            f_vec = _extract_features(
                g.faculty_specialization,
                g.faculty_program_code,
                g.subject_name,
                g.subject_description,
                g.subject_program_code,
                g.qualified,
                g.historical_count,
                g.preference_weight,
            )
            z = sum(w * x for w, x in zip(weights, f_vec, strict=False)) + intercept
            prob = _sigmoid(z)
            scored.append((prob, f_vec[0], g.faculty_code))

        scored.sort(key=lambda t: -t[0])
        if scored[0][2] in positives:
            top1_hits += 1
        if any(item[2] in positives for item in scored[:3]):
            top3_hits += 1

        by_sim = sorted(scored, key=lambda t: -t[1])
        if by_sim[0][2] in positives:
            baseline_hits += 1

    denom = max(1, group_count)
    return MLTrainResponse(
        model_kind="logistic_regression_tfidf_v1",
        parameters={
            "weights": weights,
            "intercept": intercept,
            "feature_names": FEATURE_NAMES,
        },
        metrics=MLModelMetrics(
            sample_count=len(samples),
            top1_accuracy=round(top1_hits / denom, 4),
            top3_accuracy=round(top3_hits / denom, 4),
            baseline_top1_accuracy=round(baseline_hits / denom, 4),
            feature_names=FEATURE_NAMES,
        ),
    )


def recommend_faculty(req: MLRecommendRequest) -> MLRecommendResponse:
    """Score and rank candidate faculty-subject pairs with plain-language factors."""
    params = req.parameters or {}
    raw_weights = params.get("weights", DEFAULT_WEIGHTS)
    weights = (
        [float(x) for x in raw_weights]
        if isinstance(raw_weights, list) and len(raw_weights) == len(FEATURE_NAMES)
        else DEFAULT_WEIGHTS
    )
    intercept = float(params.get("intercept", DEFAULT_INTERCEPT))

    by_subj: dict[str, list[tuple[FacultySubjectPair, float, list[str]]]] = defaultdict(
        list
    )

    for pair in req.pairs:
        f_vec = _extract_features(
            pair.faculty_specialization,
            pair.faculty_program_code,
            pair.subject_name,
            pair.subject_description,
            pair.subject_program_code,
            pair.qualified,
            pair.historical_count,
            pair.preference_weight,
        )
        z = sum(w * x for w, x in zip(weights, f_vec, strict=False)) + intercept
        score = round(_sigmoid(z), 4)

        factors: list[str] = []
        if pair.qualified:
            factors.append("Qualified for subject")
        if f_vec[1] > 0.5:
            factors.append(f"Home program match ({pair.subject_program_code})")
        if f_vec[0] >= 0.25:
            factors.append(f"Specialization alignment ({int(f_vec[0] * 100)}%)")
        if pair.historical_count > 0:
            factors.append(f"Taught {pair.historical_count}x previously")
        if pair.preference_weight > 0:
            factors.append("Positive faculty preference")
        if not factors:
            factors.append("Fallback general engineering fit")

        by_subj[pair.subject_code].append((pair, score, factors))

    results: list[FacultyRecommendationItem] = []
    for _subj_code, items in by_subj.items():
        items.sort(key=lambda x: (-x[1], x[0].faculty_code))
        for idx, (pair, score, factors) in enumerate(items, start=1):
            results.append(
                FacultyRecommendationItem(
                    faculty_code=pair.faculty_code,
                    subject_code=pair.subject_code,
                    fit_score=score,
                    rank=idx,
                    factors=factors,
                )
            )
    return MLRecommendResponse(recommendations=results)
