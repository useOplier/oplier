/**
 * packages/llm/src/tools/schema-convert.ts
 *
 * Converts our Zod tool-input schemas (the single source of truth, per master plan) into the
 * JSON-Schema-ish shape each provider's function-calling API expects.
 *
 * DELIBERATE SCOPE NOTE: this is a small hand-rolled converter, not the `zod-to-json-schema`
 * npm package. Our tool schemas (tool-definitions.ts) only use: object, string, number, boolean,
 * enum, literal-union, array, optional, nullable, default, describe(). That's the actual surface
 * this file supports — it is NOT a general Zod->JSONSchema converter and will throw a clear error
 * on an unsupported node rather than silently emitting something wrong. If a future tool needs a
 * Zod feature not listed above, extend `zodNodeToJsonSchema` rather than reaching for a shortcut.
 * (Reason for hand-rolling instead of pulling in the library: this sandbox has no network access
 * to `npm install` and verify a real dependency version against real output — see BENCHMARK_NOTES.md
 * for the same constraint applied to provider benchmarking. Swap in `zod-to-json-schema` once the
 * project has real installs and CI, but re-run every tool through both providers again after the
 * swap — don't assume identical output.)
 */

import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEnum,
  ZodLiteral,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRawShape,
  ZodString,
  ZodTypeAny,
  ZodUnion,
} from "zod";

export interface JsonSchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: (string | number)[];
  nullable?: boolean;
  // OpenAI-compatible (DeepSeek/Groq) tolerates this; Gemini does not — stripped by the Gemini
  // sanitizer below.
  additionalProperties?: boolean;
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean } {
  let inner = schema;
  let optional = false;
  let nullable = false;
  // Peel ZodOptional / ZodNullable / ZodDefault in any order/combination.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (inner instanceof ZodOptional) {
      optional = true;
      inner = inner._def.innerType;
    } else if (inner instanceof ZodNullable) {
      nullable = true;
      inner = inner._def.innerType;
    } else if (inner instanceof ZodDefault) {
      optional = true;
      inner = inner._def.innerType;
    } else {
      break;
    }
  }
  return { inner, optional, nullable };
}

function zodNodeToJsonSchema(schemaIn: ZodTypeAny): JsonSchemaNode {
  const { inner, nullable } = unwrap(schemaIn);
  const description = (schemaIn as any)._def?.description ?? (inner as any)._def?.description;

  let node: JsonSchemaNode;

  if (inner instanceof ZodString) {
    node = { type: "string" };
  } else if (inner instanceof ZodNumber) {
    node = { type: "number" };
  } else if (inner instanceof ZodBoolean) {
    node = { type: "boolean" };
  } else if (inner instanceof ZodEnum) {
    node = { type: "string", enum: inner._def.values as string[] };
  } else if (inner instanceof ZodLiteral) {
    // NOTE: numeric literals must NOT emit `enum` — Gemini's Schema.enum is string-only on the
    // wire and rejects integer entries with HTTP 400 (seen live: withinHours union of 1|24).
    // A single-value enum carries no information anyway; the number case is just {type:"number"}.
    node =
      typeof inner._def.value === "number"
        ? { type: "number" }
        : { type: "string", enum: [inner._def.value] };
  } else if (inner instanceof ZodUnion) {
    // Two union shapes are supported:
    //  1. Unions of ZodLiteral (a hand-written enum, e.g. amountType).
    //  2. Unions of ZodObject variants (e.g. ConditionSpec's per-conditionType shapes) —
    //     flattened via mergeObjectUnion below.
    const options = inner._def.options as ZodTypeAny[];
    const members = options.map((o: ZodTypeAny) => unwrap(o).inner);
    if (members.every((m) => m instanceof ZodLiteral)) {
      const values = members.map((m) => (m as ZodLiteral<string | number>)._def.value);
      if (values.every((v) => typeof v === "string")) {
        node = { type: "string", enum: values as string[] };
      } else if (values.every((v) => typeof v === "number")) {
        // Same Gemini restriction as the ZodLiteral branch above: numeric enums can't ride in
        // `enum`, so the allowed values move into the description instead.
        node = { type: "number", description: `Must be exactly one of these numeric values: ${values.join(", ")}.` };
      } else {
        throw new Error("schema-convert: mixed string/number literal unions are not supported");
      }
    } else if (members.every((m) => m instanceof ZodObject)) {
      node = mergeObjectUnion(members as ZodObject<ZodRawShape>[]);
    } else {
      throw new Error(
        "schema-convert: unsupported ZodUnion (members must be all literals or all objects) — see file header",
      );
    }
  } else if (inner instanceof ZodArray) {
    node = { type: "array", items: zodNodeToJsonSchema(inner._def.type) };
  } else if (inner instanceof ZodObject) {
    const shape = inner._def.shape();
    const properties: Record<string, JsonSchemaNode> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape) as [string, ZodTypeAny][]) {
      const { optional: fieldOptional } = unwrap(value);
      properties[key] = zodNodeToJsonSchema(value);
      if (!fieldOptional) required.push(key);
    }
    node = { type: "object", properties, ...(required.length ? { required } : {}) };
  } else {
    throw new Error(`schema-convert: unsupported Zod node (${inner.constructor.name}) — see file header`);
  }

  // Append rather than overwrite: the numeric-literal-union branch above pre-fills a description
  // with the allowed values, which must survive alongside any .describe() text.
  if (description) {
    node.description = node.description ? `${node.description} ${description}` : description;
  }
  if (nullable) node.nullable = true;
  return node;
}

/**
 * Flatten a union of object variants into ONE merged object schema.
 *
 * Why flattening and not oneOf/anyOf: Gemini's function-declaration `parameters` subset accepts
 * neither (see toGeminiFunctionParameters below), and emitting oneOf only on the OpenAI-compatible
 * path would make the same tool schema render two different ways depending on the active provider.
 * The merge keeps every variant's properties, turns per-variant literal tags (e.g. conditionType)
 * into a single enum of all their values, and marks a property `required` only when EVERY variant
 * requires it. This is deliberately looser than the Zod schema it came from — the backend
 * re-validates the full spec with real Zod (POST /systems/validate), so the tool schema's job is
 * to steer the model, not to be the validation authority.
 */
function mergeObjectUnion(variants: ZodObject<ZodRawShape>[]): JsonSchemaNode {
  type ObjectSchemaNode = JsonSchemaNode & { properties: Record<string, JsonSchemaNode> };
  const nodes = variants.map((v) => zodNodeToJsonSchema(v) as ObjectSchemaNode);
  const names = [...new Set(nodes.flatMap((n) => Object.keys(n.properties ?? {})))];
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const name of names) {
    const perVariant = nodes.map((n) => n.properties?.[name]);
    const defined = perVariant.filter((p): p is JsonSchemaNode => p !== undefined);
    const types = new Set(defined.map((p) => p.type));
    if (types.size > 1) {
      throw new Error(
        `schema-convert: union variants define property "${name}" with conflicting types ` +
          `(${[...types].join(", ")}) — cannot flatten into one object schema`,
      );
    }
    const merged: JsonSchemaNode = { ...defined[0] };
    // Per-variant literal tags arrive as single-value enums; union them so the model sees every
    // allowed value (e.g. conditionType: ["PRICE_VALUE", "PRICE_PERCENT", ...]).
    const enumLists = defined.map((p) => p.enum).filter((e): e is (string | number)[] => e !== undefined);
    if (defined.length > 0 && enumLists.length === defined.length) {
      merged.enum = [...new Set(enumLists.flat())];
    }
    properties[name] = merged;
    if (perVariant.every((p, i) => nodes[i].required?.includes(name))) {
      required.push(name);
    }
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

/** OpenAI-compatible shape (DeepSeek + Groq). */
export function toOpenAIFunctionParameters(schema: ZodTypeAny): JsonSchemaNode {
  const node = zodNodeToJsonSchema(schema);
  if (node.type !== "object") {
    throw new Error("Tool input schema must be a ZodObject at the top level");
  }
  return { ...node, additionalProperties: false };
}

/**
 * Gemini's function-declaration `parameters` field accepts only a restricted subset of OpenAPI
 * 3.0 Schema: type, format, description, nullable, enum, properties, required, items. It does
 * NOT accept `additionalProperties`, `$schema`, `default`, or JSON-Schema-proper `oneOf`/`anyOf`/
 * `allOf`/`$ref`. We already never emit those from zodNodeToJsonSchema except
 * `additionalProperties`, which the OpenAI path adds — so the Gemini path builds its own node
 * without it rather than stripping the OpenAI one after the fact (stripping-after-the-fact is
 * how normalization bugs sneak in when a provider adds a new field later).
 */
export function toGeminiFunctionParameters(schema: ZodTypeAny): JsonSchemaNode {
  const node = zodNodeToJsonSchema(schema);
  if (node.type !== "object") {
    throw new Error("Tool input schema must be a ZodObject at the top level");
  }
  return stripUnsupportedForGemini(node);
}

function stripUnsupportedForGemini(node: JsonSchemaNode): JsonSchemaNode {
  const { additionalProperties, ...rest } = node;
  if (rest.properties) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([k, v]) => [k, stripUnsupportedForGemini(v)]),
    );
  }
  if (rest.items) {
    rest.items = stripUnsupportedForGemini(rest.items);
  }
  return rest;
}
