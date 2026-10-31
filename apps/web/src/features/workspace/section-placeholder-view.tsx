"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useShell } from "@/features/shell/providers";

export interface SectionPlaceholderProps {
  title: string;
  phaseBadge: string;
  description: string;
  deliverables: readonly string[];
}

export function SectionPlaceholderView({
  title,
  phaseBadge,
  description,
  deliverables,
}: SectionPlaceholderProps) {
  const { selectedTerm } = useShell();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {title}
            </h1>
            <Badge variant="orange">{phaseBadge}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--ordiq-muted)]">
            Active term:{" "}
            <span className="font-semibold text-[var(--ordiq-ink)]">
              {selectedTerm.label}
            </span>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{title} Workspace</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-[var(--ordiq-ink)]">
            {deliverables.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

