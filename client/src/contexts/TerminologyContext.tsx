import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TerminologySettings } from "@shared/schema";

type TerminologyData = Partial<TerminologySettings>;

const TerminologyContext = createContext<TerminologyData>({});

export function TerminologyProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<TerminologySettings>({
    queryKey: ["/api/terminology"],
  });

  return (
    <TerminologyContext.Provider value={data ?? {}}>
      {children}
    </TerminologyContext.Provider>
  );
}

export function useTerminologyContext(): TerminologyData {
  return useContext(TerminologyContext);
}
