"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import * as React from "react";
import { Button } from "./button";

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  icon,
  isLoading = false,
}: ConfirmationModalProps) {
  // Handle ESC key press
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  // Prevent background scroll when modal is open
  React.useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const defaultIcon =
    variant === "danger" ? (
      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
    ) : variant === "warning" ? (
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
    ) : null;

  const iconToRender = icon ?? defaultIcon;

  const confirmButtonClass =
    variant === "danger"
      ? "bg-red-700 hover:bg-red-800 text-white border-transparent shadow-xs"
      : variant === "warning"
        ? "bg-amber-600 hover:bg-amber-700 text-white border-transparent shadow-xs"
        : "bg-[#5a0e19] hover:bg-[#480a13] text-white border-transparent shadow-xs";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={() => {
          if (!isLoading) onClose();
        }}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-5 sm:p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-[var(--ordiq-ink)]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] transition disabled:opacity-50 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header Row: Icon + Title inline on the same line (no icon background container) */}
        <div className="flex items-center gap-2.5 pr-8">
          {iconToRender && (
            <span className="shrink-0 flex items-center justify-center">
              {iconToRender}
            </span>
          )}
          <h3 id="modal-title" className="text-base font-bold text-[var(--ordiq-ink)] leading-snug">
            {title}
          </h3>
        </div>

        {/* Description: Positioned below the icon, spanning full width (not indented) */}
        <div className="mt-3 text-xs text-[var(--ordiq-muted)] leading-relaxed">
          {description}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto text-xs"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void onConfirm()}
            disabled={isLoading}
            className={`w-full sm:w-auto text-xs font-semibold ${confirmButtonClass}`}
          >
            {isLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
