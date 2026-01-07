import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

import { sampleXmlAction } from "./__mocks__/xmlActionResponse";

const buildTenantEnv = () => ({
  ...originalEnv,
  OLVM_TENANTS: JSON.stringify([
    {
      id: "t1",
      name: "Test",
      baseUrl: "https://olvm.example/api",
      username: "user",
      password: "pass",
    },
  ]),
});

const mockFetch = (
  payload: unknown,
  status = 200,
  contentType = "application/json",
) =>
  vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => {
      if (payload === null) return "";
      if (contentType.includes("xml")) return payload as string;
      return JSON.stringify(payload);
    },
  }));

const loadClient = async () => {
  vi.resetModules();
  return import("../src/lib/olvmClient");
};

beforeEach(() => {
  process.env = buildTenantEnv();
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

describe("olvmClient", () => {
  it("normalizes VM list and metrics", async () => {
    const vmPayload = {
      id: "1",
      name: "vm-1",
      status: { state: "up" },
      cluster: { name: "cluster-a" },
      template: { id: "tpl-1" },
      host: { name: "host-1" },
      memory: 4096 * 1024 * 1024,
      cpu: { topology: { cores: 2, sockets: 1 } },
      statistics: {
        statistic: [
          { name: "cpu.current.guest", values: { value: [{ datum: 12.5 }] } },
          { name: "memory.usage", values: { value: [{ datum: 66 }] } },
          { name: "disk.read.bytes", values: { value: [{ datum: 1024 }] } },
          { name: "disk.write.bytes", values: { value: [{ datum: 2048 }] } },
          {
            name: "net.received.bytes",
            values: { value: [{ datum: 500 }] },
          },
          {
            name: "net.transmitted.bytes",
            values: { value: [{ datum: 700 }] },
          },
        ],
      },
    };
    // Simulate format=json returning root.vm[]
    const payload = { vm: [vmPayload] };

    const fetchSpy = mockFetch(payload);
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { fetchVms } = await loadClient();
    const vms = await fetchVms("t1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://olvm.example/api/vms?all_content=true&format=json",
    );
    expect(vms[0]).toMatchObject({
      id: "1",
      name: "vm-1",
      status: "up",
      cluster: "cluster-a",
      template: "tpl-1",
      host: "host-1",
      memoryMB: 4096,
      cpuCores: 2,
      sockets: 1,
      metrics: {
        cpuPercent: 12.5,
        memoryPercent: 66,
        diskReadBytes: 1024,
        diskWriteBytes: 2048,
        networkBytes: 1200,
      },
    });
  });

  it("rejects unsupported VM actions", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendVmAction } = await loadClient();

    await expect(sendVmAction("t1", "vm-1", "invalid")).rejects.toThrow(
      /unsupported vm action/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends supported VM action with POST", async () => {
    const fetchSpy = mockFetch(sampleXmlAction, 200, "application/xml");
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { sendVmAction } = await loadClient();

    await sendVmAction("t1", "vm-1", "start");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://olvm.example/api/vms/vm-1/start");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
  });

  it("surfacing connection errors with endpoint info", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND olvm.example");
    }) as unknown as typeof fetch;
    const { fetchVms } = await loadClient();

    await expect(fetchVms("t1")).rejects.toThrow(
      /no se pudo conectar con olvm/i,
    );
  });
});
