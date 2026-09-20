import type { GeneratorConfig } from "./config.js";
import type { EnumPlan } from "./enum-generator.js";
import type {
  Diagnostic,
  NormalizedOperation,
  NormalizedSchema,
} from "./model.js";

// Core options only; no configuration file loading.
export type GenerationOptions = GeneratorConfig;
export type PlannedOperation = {
  operation: NormalizedOperation;
  name: string;
  schemaNames: string[];
};
export type PlannedModule = {
  name: string;
  operations: PlannedOperation[];
  schemaNames: string[];
};
export type GenerationPlan = {
  modules: PlannedModule[];
  schemaDependencies: Record<string, string[]>;
  schemaUsage: Record<string, string[]>;
  sharedSchemas: string[];
  sharedSchemaNames: string[];
  schemaOwners: Record<string, string | null>;
  stronglyConnectedComponents: string[][];
  excludedOperations: string[];
  deferredOperations: Array<{
    operationId?: string;
    location: string;
    reasons: string[];
  }>;
  diagnostics: Diagnostic[];
  stats: {
    operations: number;
    generatedOperations: number;
    deferredOperations: number;
    modules: number;
    schemas: number;
    generatedSchemas: number;
    deferredSchemas: number;
    unusedSchemas: number;
  };
};
export type GeneratedFile = { path: string; content: string };
export type GenerationResult = {
  plan: GenerationPlan;
  files: GeneratedFile[];
  enums: EnumPlan;
};
export type TypeContext = {
  schemas: Record<string, NormalizedSchema>;
  options: GenerationOptions;
  diagnostics: Diagnostic[];
  prefix?: string;
  reference?: (name: string) => string;
  localReference?: (name: string) => string;
};
