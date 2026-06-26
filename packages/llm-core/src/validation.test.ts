// LLM Core tests cover validation behavior.
import { describe, expect, it } from "vitest";
import type { Tool } from "./types.js";
import { validateToolArguments } from "./validation.js";

const decimalTool = {
  name: "decimal-tool",
  description: "test tool",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number" },
      count: { type: "integer" },
    },
    required: ["amount", "count"],
    additionalProperties: false,
  },
} as Tool;

describe("validateToolArguments", () => {
  it("coerces strict decimal numeric strings for plain JSON schemas", () => {
    expect(
      validateToolArguments(decimalTool, {
        type: "toolCall",
        id: "call-1",
        name: "decimal-tool",
        arguments: { amount: "1e3", count: "+3" },
      }),
    ).toEqual({ amount: 1000, count: 3 });
  });

  it("rejects non-decimal numeric strings for plain JSON schemas", () => {
    expect(() =>
      validateToolArguments(decimalTool, {
        type: "toolCall",
        id: "call-1",
        name: "decimal-tool",
        arguments: { amount: "0x10", count: "0b10" },
      }),
    ).toThrow(/Validation failed for tool "decimal-tool"/);
  });

  it("coerces JSON-stringified arrays when schema expects array type", () => {
    const arrayTool = {
      name: "array-tool",
      description: "test tool with array param",
      parameters: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["tags"],
        additionalProperties: false,
      },
    } as Tool;

    expect(
      validateToolArguments(arrayTool, {
        type: "toolCall",
        id: "call-1",
        name: "array-tool",
        arguments: { tags: '["test","debug"]' },
      }),
    ).toEqual({ tags: ["test", "debug"] });
  });

  it("coerces JSON-stringified objects when schema expects object type", () => {
    const objectTool = {
      name: "object-tool",
      description: "test tool with object param",
      parameters: {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: { key: { type: "string" } },
            additionalProperties: false,
          },
        },
        required: ["config"],
        additionalProperties: false,
      },
    } as Tool;

    expect(
      validateToolArguments(objectTool, {
        type: "toolCall",
        id: "call-1",
        name: "object-tool",
        arguments: { config: '{"key":"value"}' },
      }),
    ).toEqual({ config: { key: "value" } });
  });

  it("rejects invalid JSON strings for array/object schemas", () => {
    const arrayTool = {
      name: "array-tool",
      description: "test tool with array param",
      parameters: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["tags"],
        additionalProperties: false,
      },
    } as Tool;

    expect(() =>
      validateToolArguments(arrayTool, {
        type: "toolCall",
        id: "call-1",
        name: "array-tool",
        arguments: { tags: "not-json" },
      }),
    ).toThrow(/Validation failed for tool "array-tool"/);
  });
});
