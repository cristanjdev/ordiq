"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useShell } from "@/features/shell/providers";

interface StructuredPartDto {
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: StructuredPartDto[];
  createdAt: string;
}

interface ConversationDto {
  id: string;
  termCode: string;
  title: string;
  messages: MessageDto[];
  updatedAt: string;
}

interface ProposalDto {
  id: string;
  scheduleId: string;
  summary: string;
  offeringCode: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  qualityDelta: number;
  resultingQualityScore: number;
  valid: boolean;
}

interface AiStateDto {
  termCode: string;
  conversations: ConversationDto[];
  proposals: ProposalDto[];
  usage: {
    requestCount: number;
    totalTokensUsed: number;
    totalEstimatedCostPhp: number;
  };
}

interface MlEvalDto {
  evaluation: {
    activeVersion: {
      id: string;
      versionNumber: number;
      kind: string;
      status: string;
      metrics: {
        sampleCount: number;
        top1Accuracy: number;
        top3Accuracy: number;
        baselineTop1Accuracy: number;
        featureNames: string[];
      };
      trainedAt: string;
    } | null;
    allVersions: Array<{
      id: string;
      versionNumber: number;
      kind: string;
      status: string;
      metrics: {
        sampleCount: number;
        top1Accuracy: number;
        top3Accuracy: number;
        baselineTop1Accuracy: number;
      };
      trainedAt: string;
    }>;
    learningEventCount: number;
    learnedPreferenceCount: number;
    comparisons: {
      modelTop1Accuracy: number;
      modelTop3Accuracy: number;
      textSimilarityBaselineTop1: number;
      randomBaselineTop1: number;
      beatsRandom: boolean;
    };
  };
}

const STARTER_PROMPTS = [
  "Check schedule conflicts for Engr. Maria Clara Santos",
  "Kumusta ang room utilization at lab usage natin?",
  "Sino ang bagay magturo ng CPE-101 ayon sa specialization?",
  "Huwag bigyan ng early class si Engr. Maria Clara Santos tuwing Lunes",
  "Compare candidates side by side for this semester",
  "Propose a change to move offering OFF-CPE-1A-CPE101 to Wednesday",
];

export function AiAssistantView() {
  const { selectedTerm } = useShell();
  const queryClient = useQueryClient();
  const [promptInput, setPromptInput] = React.useState("");
  const [activeConversationId, setActiveConversationId] = React.useState<
    string | undefined
  >(undefined);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const aiQuery = useQuery<AiStateDto>({
    queryKey: ["ai-state", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/ai?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as AiStateDto;
    },
    retry: false,
  });

  const mlQuery = useQuery<MlEvalDto>({
    queryKey: ["ml-eval", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch("/api/v1/ml");
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as MlEvalDto;
    },
    retry: false,
  });

  const chatMutation = useMutation({
    mutationFn: async (promptText: string) => {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          termCode: selectedTerm.id,
          conversationId: activeConversationId,
          prompt: promptText,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Chat request failed");
      }
      return (await res.json()) as { conversationId: string };
    },
    onSuccess: async (data) => {
      setActiveConversationId(data.conversationId);
      setPromptInput("");
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (err) => {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to send message",
      );
    },
  });

  const proposalMutation = useMutation({
    mutationFn: async (input: {
      proposalId: string;
      decision: "APPLY" | "REJECT";
    }) => {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_proposal",
          proposalId: input.proposalId,
          decision: input.decision,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Proposal action failed");
      }
      return res.json();
    },
    onSuccess: async (_, vars) => {
      setStatusMessage(
        `Proposal ${vars.decision === "APPLY" ? "applied and re-validated" : "rejected"}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
  });

  const trainMlMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/ml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "train",
          termCode: selectedTerm.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to train ML fit model");
      return res.json();
    },
    onSuccess: async () => {
      setStatusMessage(
        "Trained faculty-subject fit model and updated ModelVersion metrics.",
      );
      await queryClient.invalidateQueries({ queryKey: ["ml-eval"] });
    },
  });

  const conversations = aiQuery.data?.conversations ?? [];
  const currentConv =
    conversations.find((c) => c.id === activeConversationId) ??
    conversations[0];
  const pendingProposals = (aiQuery.data?.proposals ?? []).filter(
    (p) => p.status === "PENDING",
  );
  const mlEval = mlQuery.data?.evaluation;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              ORDIQ AI Assistant & ML Studio
            </h1>
            <Badge variant="default">Phase 4 & 5 · Privacy Gateway + ML</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            Conversational scheduling assistant in English, Filipino, and Taglish
            with automatic{" "}
            <code className="font-mono">Faculty.alias</code> pseudonymization
            and ML faculty–subject fit ranking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" />0 Faculty Names Egress
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => trainMlMutation.mutate()}
            disabled={trainMlMutation.isPending}
          >
            <BrainCircuit className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
            Train / Refresh ML Fit Model
          </Button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* Main Two-Column GPT-style Layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Sidebar: Conversations, Quick Actions (Fig. 4), Pending Proposals */}
        <div className="space-y-4 lg:col-span-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Actions (Fig. 4)</CardTitle>
              <CardDescription>
                One-click validated scheduling actions
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button
                variant="default"
                size="sm"
                className="justify-start"
                onClick={() =>
                  chatMutation.mutate(
                    "Find alternative slots for offering OFF-CPE-1A-CPE101",
                  )
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate alternatives
              </Button>
              <Link href="/schedules">
                <Button
                  variant="maroonOutline"
                  size="sm"
                  className="w-full justify-start"
                >
                  Show in spreadsheet
                </Button>
              </Link>
              <Button
                variant="maroonOutline"
                size="sm"
                className="justify-start"
                onClick={() =>
                  chatMutation.mutate("Check room conflicts across all rooms")
                }
              >
                Check room conflicts
              </Button>
            </CardContent>
          </Card>

          {/* Pending Change Proposals Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Pending Change Proposals ({pendingProposals.length})
              </CardTitle>
              <CardDescription>
                The AI cannot apply changes directly. Only the Dean can Apply or
                Reject a validated proposal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {pendingProposals.length === 0 ? (
                <p className="text-xs text-[var(--ordiq-muted)]">
                  No pending proposals. Ask the assistant to propose a move.
                </p>
              ) : (
                pendingProposals.map((prop) => (
                  <div
                    key={prop.id}
                    className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{prop.offeringCode}</span>
                      <Badge variant={prop.valid ? "success" : "danger"}>
                        {prop.valid ? "0 Hard Conflicts" : "Has Conflict"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[var(--ordiq-muted)]">
                      {prop.summary}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() =>
                          proposalMutation.mutate({
                            proposalId: prop.id,
                            decision: "APPLY",
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          proposalMutation.mutate({
                            proposalId: prop.id,
                            decision: "REJECT",
                          })
                        }
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Phase 5D: ML Model Performance Summary Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Phase 5 ML Fit Model Performance
              </CardTitle>
              <CardDescription>
                Regularized Logistic Regression + Local Character/Token N-Gram
                Embeddings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {mlEval?.activeVersion ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Active Version:
                    </span>
                    <Badge variant="success">
                      v{mlEval.activeVersion.versionNumber} (
                      {mlEval.activeVersion.kind})
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Held-Out Top-1 Accuracy:
                    </span>
                    <span className="font-semibold">
                      {(
                        mlEval.comparisons.modelTop1Accuracy * 100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Held-Out Top-3 Accuracy:
                    </span>
                    <span className="font-semibold">
                      {(
                        mlEval.comparisons.modelTop3Accuracy * 100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Text Similarity Baseline:
                    </span>
                    <span>
                      {(
                        mlEval.comparisons.textSimilarityBaselineTop1 * 100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Random Baseline:
                    </span>
                    <span>
                      {(mlEval.comparisons.randomBaselineTop1 * 100).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ordiq-muted)]">
                      Learned Preferences:
                    </span>
                    <span>{mlEval.learnedPreferenceCount}</span>
                  </div>
                </>
              ) : (
                <p className="text-[var(--ordiq-muted)]">
                  Cold-start mode active (NLP similarity ranking). Click
                  &ldquo;Train / Refresh ML Fit Model&rdquo; to train on
                  semester assignments.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Full-Page GPT-Style Chat Workspace */}
        <div className="lg:col-span-8">
          <Card className="flex h-[680px] flex-col">
            <CardHeader className="border-b border-[var(--ordiq-border)] pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-[var(--ordiq-maroon)]" />
                  <CardTitle className="text-sm">
                    {currentConv?.title ??
                      "New Scheduling Assistant Conversation"}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[var(--ordiq-muted)]">
                  <span>
                    Tokens used: {aiQuery.data?.usage.totalTokensUsed ?? 0}
                  </span>
                  <span>·</span>
                  <span>
                    Est. Cost: ₱
                    {(aiQuery.data?.usage.totalEstimatedCostPhp ?? 0).toFixed(
                      2,
                    )}
                  </span>
                </div>
              </div>
            </CardHeader>

            {/* Messages Area */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
              {!currentConv || currentConv.messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-4">
                    <p className="font-semibold text-[var(--ordiq-ink)]">
                      Welcome to the ORDIQ Conversational Assistant (English,
                      Filipino & Taglish)
                    </p>
                    <p className="mt-1 text-[var(--ordiq-muted)]">
                      Select a starter prompt below or type your own instruction.
                      Every outgoing prompt is scrubbed of faculty names via{" "}
                      <code className="font-mono">Faculty.alias</code> and
                      restored in real time.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {STARTER_PROMPTS.map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => chatMutation.mutate(sp)}
                        className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-3 text-left text-xs hover:border-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-surface-muted)]"
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                currentConv.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col gap-2 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-[var(--ordiq-maroon)] text-white"
                          : "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-ink)]"
                      }`}
                    >
                      <p className="leading-relaxed">{msg.content}</p>
                    </div>

                    {/* Structured Message Parts */}
                    {msg.parts?.map((part, idx) => (
                      <div
                        key={`${msg.id}-part-${idx}`}
                        className="w-full max-w-[85%] rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-3 text-xs"
                      >
                        <div className="flex items-center justify-between border-b border-[var(--ordiq-border)] pb-1.5 font-semibold">
                          <span>{part.title}</span>
                          <Badge variant="neutral">{part.kind}</Badge>
                        </div>
                        <pre className="mt-2 max-h-40 overflow-auto text-[11px] text-[var(--ordiq-muted)]">
                          {JSON.stringify(part.data, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Input Area + Mandatory Verification Notice (Phase 4D) */}
            <div className="border-t border-[var(--ordiq-border)] p-3.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!promptInput.trim()) return;
                  chatMutation.mutate(promptInput.trim());
                }}
                className="flex items-center gap-2 rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 py-2"
              >
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Ask in English, Filipino, or Taglish (e.g., 'Check conflicts for Engr. Maria Clara Santos')..."
                  aria-label="Chat message input"
                  className="w-full bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="default"
                  disabled={chatMutation.isPending || !promptInput.trim()}
                >
                  <SendHorizontal className="h-3.5 w-3.5" />
                  Send
                </Button>
              </form>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--ordiq-muted)]">
                <AlertTriangle className="h-3 w-3 text-amber-600" />
                AI can make mistakes. Please verify important information.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

