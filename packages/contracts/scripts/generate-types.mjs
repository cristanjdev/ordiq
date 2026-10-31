/**
 * Deterministic OpenAPI 3.1 -> TypeScript generator for @ordiq/contracts.
 *
 * Usage:
 *   node ./scripts/generate-types.mjs          # writes src/openapi.gen.ts
 *   node ./scripts/generate-types.mjs --check  # verifies src/openapi.gen.ts is up-to-date
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const openapiPath = path.join(pkgRoot, "openapi.json");
const outPath = path.join(pkgRoot, "src", "openapi.gen.ts");

function schemaToTs(schema, indent = "    ") {
  if (!schema) return "unknown";
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/components/schemas/", "");
    return `components["schemas"][${JSON.stringify(refName)}]`;
  }
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((s) => schemaToTs(s, indent)).join(" | ");
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  if (schema.type === "array") {
    const itemType = schemaToTs(schema.items, indent);
    return `Array<${itemType}>`;
  }
  if (schema.type === "object" || schema.properties) {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const keys = Object.keys(props).sort();
    if (keys.length === 0) {
      return "Record<string, unknown>";
    }
    const lines = ["{"];
    for (const key of keys) {
      const propSchema = props[key];
      const isReq = required.has(key) || propSchema.default !== undefined;
      const opt = isReq ? "" : "?";
      lines.push(
        `${indent}  ${JSON.stringify(key)}${opt}: ${schemaToTs(propSchema, indent + "  ")};`,
      );
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
  }
  return "unknown";
}

function generate(spec) {
  const lines = [
    "/**",
    " * AUTO-GENERATED FROM packages/contracts/openapi.json — DO NOT EDIT MANUALLY.",
    " * Run `pnpm contracts:generate` to regenerate.",
    " */",
    "",
    "export interface components {",
    "  schemas: {",
  ];

  const schemas = spec.components?.schemas ?? {};
  for (const name of Object.keys(schemas).sort()) {
    const schema = schemas[name];
    if (schema.description) {
      lines.push(`    /** ${schema.description} */`);
    }
    lines.push(`    ${JSON.stringify(name)}: ${schemaToTs(schema, "    ")};`);
  }

  lines.push("  };");
  lines.push("}");
  lines.push("");
  lines.push("export interface paths {");

  const paths = spec.paths ?? {};
  for (const routePath of Object.keys(paths).sort()) {
    lines.push(`  ${JSON.stringify(routePath)}: {`);
    const methods = paths[routePath];
    for (const method of Object.keys(methods).sort()) {
      const op = methods[method];
      lines.push(`    ${JSON.stringify(method)}: {`);
      lines.push("      responses: {");
      const responses = op.responses ?? {};
      for (const statusCode of Object.keys(responses).sort()) {
        const res = responses[statusCode];
        const jsonSchema = res.content?.["application/json"]?.schema;
        const tsType = jsonSchema ? schemaToTs(jsonSchema, "        ") : "unknown";
        lines.push(`        ${statusCode}: ${tsType};`);
      }
      lines.push("      };");
      lines.push("    };");
    }
    lines.push("  };");
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const spec = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
const expected = generate(spec);
const isCheck = process.argv.includes("--check");

if (isCheck) {
  if (!fs.existsSync(outPath)) {
    console.error(`Missing generated file: ${outPath}`);
    process.exit(1);
  }
  const actual = fs.readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
  if (actual !== expected) {
    console.error(
      "Contract types in packages/contracts/src/openapi.gen.ts are out of sync with openapi.json.",
    );
    process.exit(1);
  }
  console.log("Contracts are fresh and in sync with openapi.json.");
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, expected, "utf8");
  console.log(`Generated ${outPath}`);
}

