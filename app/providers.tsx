"use client";

import type { ReactNode } from "react";
import { TRPCReactProvider } from "@/trpc/client";

export function Providers({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <TRPCReactProvider>{children}</TRPCReactProvider>;
}
