import { describe, expect, it } from "vitest";
import type { Messages } from "@/components/LocaleProvider";
import { adminMessages } from "./admin";
import { authMessages } from "./auth";
import { consoleMessages } from "./console";
import { dashboardMessages } from "./dashboard";

const catalogs: Record<string, Messages> = {
  admin: adminMessages,
  auth: authMessages,
  console: consoleMessages,
  dashboard: dashboardMessages,
};

describe("translation catalogs", () => {
  it.each(Object.entries(catalogs))("has all locales for %s messages", (_name, messages) => {
    for (const translation of Object.values(messages)) {
      expect(translation.es.trim()).not.toBe("");
      expect(translation.en.trim()).not.toBe("");
      expect(translation.de.trim()).not.toBe("");
      expect(translation.pt.trim()).not.toBe("");
    }
  });

  it.each(Object.entries(catalogs))("uses matching placeholders in %s messages", (_name, messages) => {
    for (const translation of Object.values(messages)) {
      const placeholders = (text: string) => [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(translation.en)).toEqual(placeholders(translation.es));
      expect(placeholders(translation.de)).toEqual(placeholders(translation.es));
      expect(placeholders(translation.pt)).toEqual(placeholders(translation.es));
    }
  });
});
