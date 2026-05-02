import { useEffect, useState } from "react";
import { getOutbox } from "@/lib/outbox-queue";

export function useOutboxCount(): number {
  const [n, setN] = useState(() => getOutbox().length);
  useEffect(() => {
    const sync = () => setN(getOutbox().length);
    window.addEventListener("outbox-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outbox-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return n;
}
