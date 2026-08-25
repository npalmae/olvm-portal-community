import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./prisma";

export type UserRole = "operator" | "user" | "admin" | "superadmin";
export type MembershipRole = Exclude<UserRole, "superadmin">;
export type TenantMembership = { tenantId: string; role: MembershipRole };

export const normalizeMembershipRole = (role: unknown): MembershipRole =>
  role === "operator" || role === "admin" ? role : "user";

export type StoredUser = {
  id: string; email: string; password: string; name: string; alias?: string | null; tenantId?: string;
  role?: UserRole; defaultTenantId?: string; globalRole?: "superadmin" | null;
  memberships?: TenantMembership[]; twoFactorEnabled?: boolean; createdAt: string;
};

export type PublicUser = Omit<StoredUser, "password"> & {
  tenantId: string; role: UserRole; defaultTenantId: string;
  globalRole: "superadmin" | null; memberships: TenantMembership[]; twoFactorEnabled: boolean;
};

type NewUserInput = {
  email: string; password: string; name: string; alias?: string; tenantId: string;
  role?: UserRole; twoFactorEnabled?: boolean;
};

export type UserUpdateInput = {
  name?: string; alias?: string | null; email?: string; password?: string; defaultTenantId?: string;
  globalRole?: "superadmin" | null; memberships?: TenantMembership[]; twoFactorEnabled?: boolean;
};

type UserWithMemberships = Awaited<ReturnType<typeof findUserByEmail>>;

const findUserByEmail = (email: string) => prisma.user.findUnique({
  where: { email: email.trim().toLowerCase() }, include: { memberships: true },
});

const toPublicUser = (user: NonNullable<UserWithMemberships>): PublicUser => {
  const memberships = user.memberships.map((m) => ({
    tenantId: m.tenantId, role: normalizeMembershipRole(m.role),
  }));
  const defaultTenantId = user.defaultTenantId ?? memberships[0]?.tenantId ?? "";
  const membership = memberships.find((m) => m.tenantId === defaultTenantId) ?? memberships[0];
  const globalRole = user.globalRole === "superadmin" ? "superadmin" : null;
  return {
    id: user.id, email: user.email, name: user.name, alias: user.alias, createdAt: user.createdAt.toISOString(),
    tenantId: defaultTenantId, role: globalRole ?? membership?.role ?? "user", defaultTenantId,
    globalRole, memberships, twoFactorEnabled: user.twoFactorEnabled,
  };
};

export const getUserByEmail = async (email: string): Promise<PublicUser | null> => {
  const user = await findUserByEmail(email);
  return user ? toPublicUser(user) : null;
};

export const createUser = async (input: NewUserInput): Promise<PublicUser> => {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) throw new Error("El usuario ya existe");
  const role: UserRole = input.role === "superadmin" ? "superadmin" : normalizeMembershipRole(input.role);
  const tenantId = input.tenantId.trim();
  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(), email, password: await bcrypt.hash(input.password, 10), name: input.name.trim(), alias: input.alias?.trim() || null,
      defaultTenantId: tenantId || null, globalRole: role === "superadmin" ? "superadmin" : null,
      twoFactorEnabled: input.twoFactorEnabled !== false,
      memberships: tenantId ? { create: [{ tenantId, role: normalizeMembershipRole(role) }] } : undefined,
    },
    include: { memberships: true },
  });
  return toPublicUser(user);
};

export const verifyUserCredentials = async (email: string, password: string): Promise<PublicUser | null> => {
  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password))) return null;
  return toPublicUser(user);
};

export const listUsers = async (): Promise<PublicUser[]> =>
  (await prisma.user.findMany({ include: { memberships: true }, orderBy: { createdAt: "asc" } })).map(toPublicUser);

export const getUserById = async (id: string): Promise<PublicUser | null> => {
  const user = await prisma.user.findUnique({ where: { id }, include: { memberships: true } });
  return user ? toPublicUser(user) : null;
};

export const updateUser = async (id: string, updates: UserUpdateInput): Promise<PublicUser> => {
  const current = await prisma.user.findUnique({ where: { id }, include: { memberships: true } });
  if (!current) throw new Error("Usuario no encontrado");
  if (updates.name !== undefined && !updates.name.trim()) throw new Error("El nombre no puede estar vacío");
  if (updates.alias !== undefined && updates.alias !== null && !updates.alias.trim()) throw new Error("El alias no puede estar vacío");
  const email = updates.email?.trim().toLowerCase();
  if (updates.email !== undefined && !email) throw new Error("El email no puede estar vacío");
  if (email && email !== current.email && await prisma.user.findUnique({ where: { email } })) throw new Error("El email ya está en uso");
  if (updates.password !== undefined && updates.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  if (updates.globalRole === null && current.globalRole === "superadmin") {
    const count = await prisma.user.count({ where: { globalRole: "superadmin" } });
    if (count <= 1) throw new Error("No se puede degradar al último superadmin");
  }

  const user = await prisma.$transaction(async (tx) => {
    if (updates.memberships !== undefined) {
      await tx.membership.deleteMany({ where: { userId: id } });
      const unique = [...new Map(updates.memberships.filter((m) => m.tenantId.trim()).map((m) => [m.tenantId.trim(), m])).values()];
      if (unique.length) await tx.membership.createMany({ data: unique.map((m) => ({ userId: id, tenantId: m.tenantId.trim(), role: normalizeMembershipRole(m.role) })) });
    }
    return tx.user.update({
      where: { id },
      data: {
        name: updates.name?.trim(), alias: updates.alias === undefined ? undefined : updates.alias?.trim() || null, email,
        password: updates.password === undefined ? undefined : await bcrypt.hash(updates.password, 10),
        defaultTenantId: updates.defaultTenantId === undefined ? undefined : updates.defaultTenantId.trim() || null,
        globalRole: updates.globalRole, twoFactorEnabled: updates.twoFactorEnabled,
      },
      include: { memberships: true },
    });
  });
  return toPublicUser(user);
};

export const deleteUser = async (id: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new Error("Usuario no encontrado");
  if (user.globalRole === "superadmin" && await prisma.user.count({ where: { globalRole: "superadmin" } }) <= 1) {
    throw new Error("No se puede eliminar al último superadmin");
  }
  await prisma.user.delete({ where: { id } });
};
