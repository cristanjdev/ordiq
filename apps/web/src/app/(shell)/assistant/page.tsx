import { Suspense } from "react";
import { AiAssistantView } from "@/features/ai/ai-assistant-view";

export default function AssistantPage() {
  // The view reads the active tab from the URL (?tab=...).
  return (
    <Suspense fallback={null}>
      <AiAssistantView />
    </Suspense>
  );
}
