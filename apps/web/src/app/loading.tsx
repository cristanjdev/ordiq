import { Loader2 } from "lucide-react";

export default function RootLoading() {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center bg-[var(--ordiq-bg)] p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--ordiq-maroon)]" />
        <p className="text-xs font-semibold tracking-wider uppercase text-[var(--ordiq-muted)]">
          Loading ORDIQ...
        </p>
      </div>
    </div>
  );
}
