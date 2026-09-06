import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { filterProviders } from "./provider-auth";

describe("filterProviders", () => {
  const providers = [
    {
      registration: "registered" as const,
      id: "anthropic",
      name: "Anthropic",
      methods: [],
      storedCredential: null,
      effectiveAuth: null,
    },
    {
      registration: "registered" as const,
      id: "openai",
      name: "OpenAI",
      methods: [],
      storedCredential: null,
      effectiveAuth: null,
    },
  ];

  it("matches by name or id case-insensitively", () => {
    expect(filterProviders(providers, "open").map((entry) => entry.id)).toEqual(["openai"]);
    expect(filterProviders(providers, "ANTHROPIC").map((entry) => entry.id)).toEqual(["anthropic"]);
    expect(filterProviders(providers, "")).toHaveLength(2);
    expect(filterProviders(providers, "missing")).toHaveLength(0);
  });
});

describe("prompt controls", () => {
  it("uses password controls, select options, and safe new-tab links", async () => {
    const source = await readFile(new URL("./provider-auth.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="password"');
    expect(source).toContain("<select");
    expect(source).toContain("<option");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer noopener"');
    expect(source).toContain("isSafeHttpUrl");
    expect(source).toContain('setTextValue("")');
    expect(source).toContain('setSelectValue("")');
  });
});
