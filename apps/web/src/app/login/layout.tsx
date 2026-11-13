import type { Metadata } from "next";
import * as React from "react";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Secure gateway for ORDIQ Dean Portal.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Strict scrollbar suppression for the authentication gateway */}
      <style>{`
        html, body {
          overflow: hidden !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
      `}</style>
      <div className="fixed inset-0 h-full h-[100dvh] w-full max-h-screen overflow-hidden no-scrollbar bg-gradient-to-br from-[#4a0a0f] via-[#2d0508] to-[#170204]">
        {children}
      </div>
    </>
  );
}
