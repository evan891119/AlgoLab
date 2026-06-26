export type Difficulty = "easy" | "medium" | "hard";

export interface ProblemMeta {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  functionName: string;
  timeLimitMs: number;
}

export interface TestCase {
  name: string;
  input: unknown[];
  expected: unknown;
}

export interface ProblemTests {
  version: 1;
  functionName: string;
  cases: TestCase[];
}

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
}

export interface ProblemDetail {
  meta: ProblemMeta;
  statement: string;
  starterCode: string;
  tests: ProblemTests;
}

export function validateProblemMeta(value: unknown): ProblemMeta {
  if (!value || typeof value !== "object") {
    throw new Error("Problem meta must be an object.");
  }

  const meta = value as Record<string, unknown>;
  const difficulty = meta.difficulty;
  if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
    throw new Error("Problem difficulty must be easy, medium, or hard.");
  }

  if (
    typeof meta.id !== "string" ||
    typeof meta.title !== "string" ||
    !Array.isArray(meta.tags) ||
    typeof meta.functionName !== "string" ||
    typeof meta.timeLimitMs !== "number"
  ) {
    throw new Error("Problem meta is missing required fields.");
  }

  return {
    id: meta.id,
    title: meta.title,
    difficulty,
    tags: meta.tags.map(String),
    functionName: meta.functionName,
    timeLimitMs: meta.timeLimitMs
  };
}
