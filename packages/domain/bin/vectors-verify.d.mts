export const VECTOR_FAMILIES: readonly [
  "events",
  "cursors",
  "proposal",
  "delta",
  "fork-pin",
  "dependency-join",
  "delta-authority",
  "context-binding",
  "receipt",
  "task-dispatch",
  "authorization",
];

export type VectorFamily = (typeof VECTOR_FAMILIES)[number];

export interface VectorContractV2 {
  readonly schemaVersion: "2";
  readonly familyVersion: "1";
  readonly family: VectorFamily;
  readonly case: string;
  readonly action: string;
  readonly input: unknown;
  readonly expected?: unknown;
  readonly expectedError?: string;
  readonly select?: readonly string[];
}

export function executeVector(vector: VectorContractV2): unknown;
export function verifyVector(vector: VectorContractV2, family: VectorFamily, file?: string): void;
export function verifyFamilies(requested: readonly VectorFamily[]): number;
