import { getTenantById } from "./config";

export type OvaDiskEntry = {
  id: string;
  name: string;
  size: number;
  storageDomainName: string;
};

export const listOvaDisks = async (
  ovaDisks: { id: string; name: string; provisioned_size?: string | number; storage_domains?: { storage_domain?: { name?: string; id?: string }[] } }[],
): Promise<OvaDiskEntry[]> => {
  return ovaDisks
    .filter((d) => {
      const name = (d.name ?? "").toLowerCase();
      return name.endsWith(".ova") || name.endsWith(".qcow2");
    })
    .map((d) => ({
      id: d.id,
      name: d.name,
      size: Number(d.provisioned_size ?? 0),
      storageDomainName: (d.storage_domains?.storage_domain ?? [])[0]?.name ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
