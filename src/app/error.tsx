"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <h2 className="text-3xl text-bone">Something went wrong</h2>
      <p className="max-w-md text-slate">The page encountered an error. Reloading usually resolves it.</p>
      <button onClick={reset} className="btn-primary">Reload the page</button>
    </div>
  );
}
