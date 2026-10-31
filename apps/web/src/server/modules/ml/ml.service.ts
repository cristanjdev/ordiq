import type {
  EngineMLRecommendRequest,
  EngineMLTrainRequest,
  Weekday,
} from "@ordiq/contracts";
import { createEngineClient } from "../../engine/engine.client";
import { withAudit } from "../../platform/audit";
import {
  type FacultyPreferenceRecord,
  getMasterDataState,
  type LearningEventRecord,
  type ModelVersionRecord,
} from "../master-data/master-data.store";

type EngineFacultySubjectPair = EngineMLRecommendRequest["pairs"][number];
type EngineHistoricalAssignmentSample =
  EngineMLTrainRequest["samples"][number];

const engineClient = createEngineClient();

export interface FacultyRecommendationDto {
  subjectCode: string;
  coldStart: boolean;
  activeModelVersion: number | null;
  recommendations: Array<{
    facultyCode: string;
    facultyName: string;
    facultyAlias: string;
    score: number;
    rank: number;
    factors: string[];
  }>;
}

export interface MlEvaluationReportDto {
  activeVersion: ModelVersionRecord | null;
  allVersions: ModelVersionRecord[];
  learningEventCount: number;
  learnedPreferenceCount: number;
  comparisons: {
    modelTop1Accuracy: number;
    modelTop3Accuracy: number;
    textSimilarityBaselineTop1: number;
    randomBaselineTop1: number;
    beatsRandom: boolean;
  };
}

/**
 * Gather positive historical (faculty, subject) assignments from:
 * 1. Accepted or imported schedules
 * 2. LearningEvents (Dean edits and schedule acceptances)
 */
function collectHistoricalSamples(
  termCode?: string,
): EngineHistoricalAssignmentSample[] {
  const state = getMasterDataState();
  const pairCounts = new Map<string, { count: number; acceptedByDean: boolean }>();

  for (const sched of state.schedules.values()) {
    if (sched.status === "ACCEPTED" || sched.source === "IMPORTED") {
      if (!termCode || sched.termCode === termCode) {
        for (const entry of sched.entries) {
          if (entry.facultyCode === "EXTERNAL") continue;
          const off = state.offerings.get(entry.offeringCode);
          if (off) {
            const key = `${entry.facultyCode}:::${off.subjectCode}`;
            const cur = pairCounts.get(key) ?? {
              count: 0,
              acceptedByDean: true,
            };
            cur.count += 1;
            cur.acceptedByDean = true;
            pairCounts.set(key, cur);
          }
        }
      }
    }
  }

  for (const ev of state.learningEvents) {
    if (!termCode || ev.termCode === termCode) {
      const key = `${ev.facultyCode}:::${ev.subjectCode}`;
      const cur = pairCounts.get(key) ?? { count: 0, acceptedByDean: true };
      cur.count += Math.max(1, Math.round(ev.weight));
      cur.acceptedByDean = true;
      pairCounts.set(key, cur);
    }
  }

  const qualSet = new Set<string>();
  for (const q of state.facultyQualifications.values()) {
    qualSet.add(`${q.facultyCode}:::${q.subjectCode}`);
  }

  const samples: EngineHistoricalAssignmentSample[] = [];
  for (const [key, info] of pairCounts.entries()) {
    const [facCode, subjCode] = key.split(":::");
    if (!facCode || !subjCode) continue;
    const fac = state.faculty.get(facCode);
    const subj = state.subjects.get(subjCode);
    if (!fac || !subj) continue;

    samples.push({
      faculty_code: fac.code,
      subject_code: subj.code,
      faculty_specialization: `${fac.specialization} ${fac.education}`,
      faculty_program_code: fac.programCode ?? "",
      subject_name: subj.name,
      subject_description: subj.description,
      subject_program_code: subj.programCode ?? "",
      subject_category: subj.category,
      qualified: qualSet.has(key),
      preference_weight: 5,
      historical_count: info.count,
      accepted_by_dean: info.acceptedByDean,
    });

    // Also include 1 negative contrast sample for a non-matching faculty on this subject
    const negFac = Array.from(state.faculty.values()).find(
      (f) => f.code !== fac.code && f.programCode !== subj.programCode,
    );
    if (negFac) {
      samples.push({
        faculty_code: negFac.code,
        subject_code: subj.code,
        faculty_specialization: `${negFac.specialization} ${negFac.education}`,
        faculty_program_code: negFac.programCode ?? "",
        subject_name: subj.name,
        subject_description: subj.description,
        subject_program_code: subj.programCode ?? "",
        subject_category: subj.category,
        qualified: false,
        preference_weight: 0,
        historical_count: 0,
        accepted_by_dean: false,
      });
    }
  }

  return samples;
}

/**
 * Record LearningEvents when a Dean edits an entry or accepts a schedule,
 * and update smoothed `LEARNED` preferences (Phase 5B & 5C).
 */
export function recordLearningEvent(input: {
  termCode: string;
  scheduleId: string;
  type: "SCHEDULE_ACCEPTED" | "DEAN_EDIT";
  facultyCode: string;
  subjectCode: string;
  weekday: Weekday;
  startMin: number;
  endMin?: number;
  semesterAge?: number;
}): LearningEventRecord {
  const state = getMasterDataState();
  const decay = Math.pow(0.75, input.semesterAge ?? 0);
  const baseWeight = input.type === "DEAN_EDIT" ? 2.5 : 1.0;

  const event: LearningEventRecord = {
    id: crypto.randomUUID(),
    termCode: input.termCode,
    scheduleId: input.scheduleId,
    type: input.type,
    facultyCode: input.facultyCode,
    subjectCode: input.subjectCode,
    weekday: input.weekday,
    startMin: input.startMin,
    weight: Number((baseWeight * decay).toFixed(3)),
    createdAt: new Date().toISOString(),
  };
  state.learningEvents.push(event);

  updateLearnedPreferencesForFaculty(input.facultyCode, input.termCode);
  return event;
}

/**
 * Phase 5B: Build per-faculty day and time-band distributions from history and Dean edits,
 * apply Laplace smoothing so one observation cannot dominate, decay older semesters,
 * and keep declared preferences (`SURVEY` / `DEAN`) above inferred (`LEARNED`) ones.
 */
export function updateLearnedPreferencesForFaculty(
  facultyCode: string,
  termCode = "AY2026-2027-S1",
): void {
  const state = getMasterDataState();
  const events = state.learningEvents.filter(
    (e) => e.facultyCode === facultyCode,
  );
  if (events.length === 0) return;

  const dayToWeight = new Map<Weekday, number>();
  const bandToWeight = new Map<string, number>();
  for (const ev of events) {
    dayToWeight.set(
      ev.weekday,
      (dayToWeight.get(ev.weekday) ?? 0) + ev.weight,
    );
    const band =
      ev.startMin < 720
        ? "450-720"
        : ev.startMin < 1020
          ? "780-1020"
          : "1020-1230";
    bandToWeight.set(band, (bandToWeight.get(band) ?? 0) + ev.weight);
  }

  const totalObserved = Array.from(dayToWeight.values()).reduce(
    (sum, w) => sum + w,
    0,
  );
  const numDays = 6;
  const alpha = 1.0; // Laplace smoothing constant

  // Remove old LEARNED preferences for this faculty before writing updated ones
  for (const [key, pref] of state.facultyPreferences.entries()) {
    if (pref.facultyCode === facultyCode && pref.source === "LEARNED") {
      state.facultyPreferences.delete(key);
    }
  }

  // Declared preferences (SURVEY or DEAN) always take priority and are never overwritten
  const declaredValues = new Set<string>();
  for (const pref of state.facultyPreferences.values()) {
    if (pref.facultyCode === facultyCode && pref.source !== "LEARNED") {
      declaredValues.add(`${pref.type}:${pref.value}`);
    }
  }

  for (const [weekday, totalWeight] of dayToWeight.entries()) {
    if (
      declaredValues.has(`PREFERRED_DAY:${weekday}`) ||
      declaredValues.has(`AVOID_DAY:${weekday}`)
    ) {
      continue;
    }

    const smoothedProb =
      (totalWeight + alpha) / (totalObserved + alpha * numDays);

    if (smoothedProb > 1 / numDays + 0.05) {
      // Learned preference weight is capped at 0.8 so declared preferences (weight >= 1.0) always dominate
      const learnedWeight = Number(
        Math.min(0.8, Math.max(0.2, smoothedProb)).toFixed(2),
      );
      const id = `${facultyCode}:LEARNED:${weekday}`;
      const record: FacultyPreferenceRecord = {
        id,
        facultyCode,
        termCode,
        type: "PREFERRED_DAY",
        value: weekday,
        weight: learnedWeight,
        source: "LEARNED",
      };
      state.facultyPreferences.set(id, record);
    }
  }

  for (const [band, totalWeight] of bandToWeight.entries()) {
    if (declaredValues.has(`PREFERRED_TIME_WINDOW:${band}`)) {
      continue;
    }
    const smoothedProb = (totalWeight + alpha) / (totalObserved + alpha * 3);
    if (smoothedProb > 1 / 3 + 0.05) {
      const learnedWeight = Number(
        Math.min(0.8, Math.max(0.2, smoothedProb)).toFixed(2),
      );
      const id = `${facultyCode}:LEARNED:BAND:${band}`;
      const record: FacultyPreferenceRecord = {
        id,
        facultyCode,
        termCode,
        type: "PREFERRED_TIME_WINDOW",
        value: band,
        weight: learnedWeight,
        source: "LEARNED",
      };
      state.facultyPreferences.set(id, record);
    }
  }
}

/**
 * Train a new faculty-subject fit model via the Python ML engine, store `ModelVersionRecord`,
 * and promote to ACTIVE only if held-out Top-1 accuracy is no worse than the current active model.
 */
export async function trainAndEvaluateFitModel(
  actor = "dean@mseuf.edu.ph",
  termCode?: string,
): Promise<{
  newVersion: ModelVersionRecord;
  promoted: boolean;
}> {
  return withAudit(
    {
      actor,
      action: "ML_MODEL_TRAIN",
      entity: "ModelVersion",
      entityId: termCode ?? "ALL",
    },
    async () => {
      const state = getMasterDataState();
      const samples = collectHistoricalSamples(termCode);

      const mlRes = await engineClient.trainMlModel({
        samples,
      });

      const currentActive = Array.from(state.modelVersions.values()).find(
        (v) => v.status === "ACTIVE",
      );
      const nextVersionNumber = state.modelVersions.size + 1;

      const shouldPromote =
        !currentActive ||
        mlRes.metrics.top1_accuracy >= currentActive.metrics.top1Accuracy;

      if (shouldPromote && currentActive) {
        state.modelVersions.set(currentActive.id, {
          ...currentActive,
          status: "ARCHIVED",
        });
      }

      const newVersion: ModelVersionRecord = {
        id: crypto.randomUUID(),
        versionNumber: nextVersionNumber,
        kind: mlRes.model_kind ?? "logistic_regression_tfidf_v1",
        status: shouldPromote ? "ACTIVE" : "CANDIDATE",
        parameters: mlRes.parameters,
        metrics: {
          sampleCount: mlRes.metrics.sample_count,
          top1Accuracy: mlRes.metrics.top1_accuracy,
          top3Accuracy: mlRes.metrics.top3_accuracy,
          baselineTop1Accuracy: mlRes.metrics.baseline_top1_accuracy,
          featureNames: mlRes.metrics.feature_names,
        },
        trainedAt: new Date().toISOString(),
      };
      state.modelVersions.set(newVersion.id, newVersion);

      return {
        newVersion,
        promoted: shouldPromote,
      };
    },
  );
}

/**
 * Roll back the active ML model version to a specified earlier `ModelVersionRecord`.
 */
export async function rollbackModelVersion(
  targetVersionId: string,
  actor = "dean@mseuf.edu.ph",
): Promise<ModelVersionRecord> {
  return withAudit(
    {
      actor,
      action: "ML_MODEL_ROLLBACK",
      entity: "ModelVersion",
      entityId: targetVersionId,
    },
    async () => {
      const state = getMasterDataState();
      const target = state.modelVersions.get(targetVersionId);
      if (!target) {
        throw new Error(`Model version '${targetVersionId}' not found.`);
      }

      for (const [id, ver] of state.modelVersions.entries()) {
        if (id === targetVersionId) {
          state.modelVersions.set(id, { ...ver, status: "ACTIVE" });
        } else if (ver.status === "ACTIVE") {
          state.modelVersions.set(id, { ...ver, status: "ARCHIVED" });
        }
      }

      const updated = state.modelVersions.get(targetVersionId);
      if (!updated) {
        throw new Error(`Model version '${targetVersionId}' not found.`);
      }
      return updated;
    },
  );
}

/**
 * Get ranked faculty recommendations for a subject (with cold-start support when no history exists).
 */
export async function getSubjectFacultyRecommendations(
  subjectCode: string,
  topK = 5,
): Promise<FacultyRecommendationDto> {
  const state = getMasterDataState();
  const activeVersion =
    Array.from(state.modelVersions.values()).find(
      (v) => v.status === "ACTIVE",
    ) ?? null;

  const subj =
    state.subjects.get(subjectCode) ??
    Array.from(state.subjects.values())[0];

  const samples = collectHistoricalSamples();
  const sampleMap = new Map<string, number>();
  for (const s of samples) {
    sampleMap.set(
      `${s.faculty_code}:::${s.subject_code}`,
      s.historical_count ?? 1,
    );
  }

  const qualSet = new Set<string>();
  for (const q of state.facultyQualifications.values()) {
    qualSet.add(`${q.facultyCode}:::${q.subjectCode}`);
  }

  const pairs: EngineFacultySubjectPair[] = Array.from(
    state.faculty.values(),
  ).map((fac) => {
    const key = `${fac.code}:::${subj?.code ?? subjectCode}`;
    return {
      faculty_code: fac.code,
      subject_code: subj?.code ?? subjectCode,
      faculty_specialization: `${fac.specialization} ${fac.education}`,
      faculty_program_code: fac.programCode ?? "",
      subject_name: subj?.name ?? subjectCode,
      subject_description: subj?.description ?? subjectCode,
      subject_program_code: subj?.programCode ?? "",
      subject_category: subj?.category ?? "MAJOR",
      qualified: qualSet.has(key),
      preference_weight: 5,
      historical_count: sampleMap.get(key) ?? 0,
    };
  });

  const recResponse = await engineClient.recommendFaculty({
    parameters: activeVersion?.parameters ?? null,
    pairs,
  });

  const coldStart = !activeVersion || samples.length === 0;

  return {
    subjectCode: subj?.code ?? subjectCode,
    coldStart,
    activeModelVersion: activeVersion?.versionNumber ?? null,
    recommendations: recResponse.recommendations
      .slice(0, topK)
      .map((item) => {
        const fac = state.faculty.get(item.faculty_code);
        return {
          facultyCode: item.faculty_code,
          facultyName: fac?.name ?? item.faculty_code,
          facultyAlias: fac?.alias ?? item.faculty_code,
          score: item.fit_score,
          rank: item.rank,
          factors: item.factors,
        };
      }),
  };
}

/**
 * Get the ML evaluation report comparing the active model against random and text-similarity baselines.
 */
export function getMlEvaluationReport(): MlEvaluationReportDto {
  const state = getMasterDataState();
  const allVersions = Array.from(state.modelVersions.values()).sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );
  const activeVersion = allVersions.find((v) => v.status === "ACTIVE") ?? null;
  const facultyCount = Math.max(1, state.faculty.size);
  const randomBaselineTop1 = Number((1 / facultyCount).toFixed(4));

  const modelTop1 = activeVersion?.metrics.top1Accuracy ?? 0;
  const modelTop3 = activeVersion?.metrics.top3Accuracy ?? 0;
  const textSimTop1 = activeVersion?.metrics.baselineTop1Accuracy ?? 0;

  const learnedPreferenceCount = Array.from(
    state.facultyPreferences.values(),
  ).filter((p) => p.source === "LEARNED").length;

  return {
    activeVersion,
    allVersions,
    learningEventCount: state.learningEvents.length,
    learnedPreferenceCount,
    comparisons: {
      modelTop1Accuracy: modelTop1,
      modelTop3Accuracy: modelTop3,
      textSimilarityBaselineTop1: textSimTop1,
      randomBaselineTop1,
      beatsRandom: modelTop1 > randomBaselineTop1,
    },
  };
}
