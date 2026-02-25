'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

// Cast needed: next-themes@0.4 types don't declare children for React 19
const Provider = NextThemesProvider as React.FC<
  React.PropsWithChildren<{
    attribute?: string;
    defaultTheme?: string;
    enableSystem?: boolean;
    disableTransitionOnChange?: boolean;
  }>
>;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </Provider>
  );
}
