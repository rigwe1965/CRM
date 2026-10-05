"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// Class-based theming ("dark" class on <html>). Follows the OS until the user picks a theme,
// and next-themes injects a tiny inline script so there is no flash of the wrong theme on load.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
