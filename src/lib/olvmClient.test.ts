import { describe, expect, it } from "vitest";
import { vmMatchesTenantTag } from "./olvmClient";

describe("vmMatchesTenantTag", () => {
  it("fails closed when the tenant has no tag", () => {
    expect(vmMatchesTenantTag({ tags: [{ name: "tenant-a" }] }, undefined)).toBe(false);
    expect(vmMatchesTenantTag({ tags: [{ name: "tenant-a" }] }, " ")).toBe(false);
  });

  it("only matches the configured tenant tag", () => {
    const vm = { tags: { tag: [{ name: "tenant-a" }] } };

    expect(vmMatchesTenantTag(vm, "TENANT-A")).toBe(true);
    expect(vmMatchesTenantTag(vm, "tenant-b")).toBe(false);
  });
});
