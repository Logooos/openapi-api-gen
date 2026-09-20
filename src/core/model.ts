export type ObjectValue = Record<string, unknown>;
export type OpenApiVersion = `3.0.${number}` | `3.1.${number}`;
export type HttpMethod =
  "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

// Raw metadata is retained; normalization never rewrites enum values or descriptions.
export type NormalizedSchema = {
  raw: ObjectValue | boolean;
  types: string[];
  nullable: boolean;
  ref?: string;
  description?: string;
  format?: string;
  required?: string[];
  enum?: unknown[];
  xEnumName?: string;
  default?: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  properties?: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
  additionalProperties?: NormalizedSchema;
  allOf?: NormalizedSchema[];
  oneOf?: NormalizedSchema[];
  anyOf?: NormalizedSchema[];
};
export type NormalizedParameter = {
  description?: string;
  deprecated?: boolean;
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema?: NormalizedSchema;
  content: Record<string, NormalizedSchema | undefined>;
  raw: ObjectValue;
};
export type NormalizedRequestBody = {
  description?: string;
  required: boolean;
  content: Record<string, NormalizedSchema | undefined>;
  raw: ObjectValue;
};
export type NormalizedResponse = {
  description: string;
  status: string;
  content: Record<string, NormalizedSchema | undefined>;
  raw: ObjectValue;
};
export type NormalizedOperation = {
  summary?: string;
  description?: string;
  deprecated?: boolean;
  operationId?: string;
  method: HttpMethod;
  path: string;
  tags: string[];
  module: string | null;
  pathParams: NormalizedParameter[];
  queryParams: NormalizedParameter[];
  headerParams: NormalizedParameter[];
  cookieParams: NormalizedParameter[];
  requestBody?: NormalizedRequestBody;
  responses: NormalizedResponse[];
  raw: ObjectValue;
};
export type Diagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  location: string;
};
export type NormalizedDocument = {
  version: OpenApiVersion;
  operations: NormalizedOperation[];
  schemas: Record<string, NormalizedSchema>;
  tags: string[];
  diagnostics: Diagnostic[];
  raw: ObjectValue;
};
