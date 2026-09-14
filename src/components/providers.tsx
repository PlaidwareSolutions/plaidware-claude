"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/confirm-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ConfirmProvider>{children}</ConfirmProvider>
      <Toaster position="top-right" />
    </ThemeProvider>
  );
}
