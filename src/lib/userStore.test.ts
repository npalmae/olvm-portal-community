import { describe, expect, it } from "vitest";
import { normalizeMembershipRole } from "./userStore";

describe("membership role normalization", () => {
  it("preserves supported roles", () => {
    expect(normalizeMembershipRole("operator")).toBe("operator");
    expect(normalizeMembershipRole("user")).toBe("user");
    expect(normalizeMembershipRole("admin")).toBe("admin");
  });

  it("fails safely to user for unknown or global roles", () => {
    expect(normalizeMembershipRole("superadmin")).toBe("user");
    expect(normalizeMembershipRole("owner")).toBe("user");
    expect(normalizeMembershipRole(undefined)).toBe("user");
  });
});
