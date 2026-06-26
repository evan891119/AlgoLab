export type TestStatus = "passed" | "failed" | "error" | "timeout";

export interface TestResult {
  name: string;
  status: TestStatus;
  input: unknown[];
  expected: unknown;
  actual?: unknown;
  error?: string;
  durationMs: number;
}

export interface RunSummary {
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
}

export function summarizeResults(results: TestResult[]): RunSummary {
  return {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status !== "passed").length,
    durationMs: results.reduce((total, result) => total + result.durationMs, 0),
    results
  };
}
