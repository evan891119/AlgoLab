export type Difficulty = "easy" | "medium" | "hard";
export type ProblemSource = "leetcode" | "hackerrank" | "codesignal" | "company" | "school" | "custom";
export type ProblemStatus = "new" | "attempted" | "solved" | "review";

export interface ProblemMeta {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  source: ProblemSource;
  sourceUrl?: string;
  examName?: string;
  topic?: string;
  pattern?: string;
  status: ProblemStatus;
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
  source: ProblemSource;
  topic?: string;
  status: ProblemStatus;
}

export interface ProblemDetail {
  meta: ProblemMeta;
  statement: string;
  starterCode: string;
  tests: ProblemTests;
}

export interface ProblemNotes {
  problemId: string;
  approach: string;
  keyInsight: string;
  mistakes: string;
  complexity: string;
  reviewNotes: string;
  updatedAt: string | null;
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
  const source = meta.source ?? "custom";
  if (
    source !== "leetcode" &&
    source !== "hackerrank" &&
    source !== "codesignal" &&
    source !== "company" &&
    source !== "school" &&
    source !== "custom"
  ) {
    throw new Error("Problem source is invalid.");
  }
  const status = meta.status ?? "new";
  if (status !== "new" && status !== "attempted" && status !== "solved" && status !== "review") {
    throw new Error("Problem status is invalid.");
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
    source,
    sourceUrl: typeof meta.sourceUrl === "string" && meta.sourceUrl ? meta.sourceUrl : undefined,
    examName: typeof meta.examName === "string" && meta.examName ? meta.examName : undefined,
    topic: typeof meta.topic === "string" && meta.topic ? meta.topic : undefined,
    pattern: typeof meta.pattern === "string" && meta.pattern ? meta.pattern : undefined,
    status,
    functionName: meta.functionName,
    timeLimitMs: meta.timeLimitMs
  };
}
