"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h2 className="text-2xl font-bold text-silver-900 dark:text-white">
        Something went wrong
      </h2>
      <p className="text-silver-600 dark:text-silver-400 max-w-md">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="rounded-full bg-silver-900 dark:bg-white px-6 py-3 text-sm font-medium text-white dark:text-silver-900 hover:bg-silver-800 dark:hover:bg-silver-100 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
