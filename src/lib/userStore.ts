import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export type UserRole = "user" | "admin" | "superadmin";
export type MembershipRole = Exclude<UserRole, "superadmin">;

export type TenantMembership = {
  tenantId: string;
  role: MembershipRole;
};

export type StoredUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  tenantId?: string;
  role?: UserRole;
  defaultTenantId?: string;
  globalRole?: "superadmin" | null;
  memberships?: TenantMembership[];
  twoFactorEnabled?: boolean;
  createdAt: string;
};

export type PublicUser = Omit<StoredUser, "password"> & {
  tenantId: string;
  role: UserRole;
  defaultTenantId: string;
  globalRole: "superadmin" | null;
  memberships: TenantMembership[];
  twoFactorEnabled: boolean;
};

type NewUserInput = {
  email: string;
  password: string;
  name: string;
  tenantId: string;
  role?: UserRole;
  twoFactorEnabled?: boolean;
};

export type UserUpdateInput = {
  name?: string;
  email?: string;
  password?: string;
  defaultTenantId?: string;
  globalRole?: "superadmin" | null;
  memberships?: TenantMembership[];
  twoFactorEnabled?: boolean;
};

const isSuperadminRecord = (user: StoredUser) =>
  user.globalRole === "superadmin" || user.role === "superadmin";

const countSuperadmins = (users: StoredUser[]) =>
  users.filter(isSuperadminRecord).length;

const storePath =
  process.env.USER_STORE_PATH ||
  path.join(process.cwd(), "data", "users.json");

const ensureStore = async () => {
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]", "utf8");
  }
};

const readUsers = async (): Promise<StoredUser[]> => {
  await ensureStore();
  const content = await fs.readFile(storePath, "utf8");
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch {
    return [];
  }
};

const writeUsers = async (users: StoredUser[]) => {
  await ensureStore();
  await fs.writeFile(storePath, JSON.stringify(users, null, 2), "utf8");
};

const normalizeMemberships = (
  user: Pick<StoredUser, "tenantId" | "role" | "memberships">,
): TenantMembership[] => {
  const memberships: TenantMembership[] = (user.memberships ?? [])
    .map((membership) => ({
      tenantId: membership.tenantId.trim(),
      role: membership.role === "admin" ? ("admin" as const) : ("user" as const),
    }))
    .filter((membership) => membership.tenantId);

  if (memberships.length) {
    return Array.from(
      new Map(
        memberships.map((membership) => [membership.tenantId, membership]),
      ).values(),
    );
  }

  if (!user.tenantId?.trim()) return [];
  return [
    {
      tenantId: user.tenantId.trim(),
      role: user.role === "admin" ? "admin" : "user",
    },
  ];
};

const toPublicUser = (user: StoredUser): PublicUser => {
  const memberships = normalizeMemberships(user);
  const defaultTenantId =
    user.defaultTenantId?.trim() || memberships[0]?.tenantId || "";
  const globalRole =
    user.globalRole === "superadmin" || user.role === "superadmin"
      ? "superadmin"
      : null;
  const membershipForDefault =
    memberships.find((membership) => membership.tenantId === defaultTenantId) ??
    memberships[0];

  return {
    ...user,
    tenantId: defaultTenantId,
    role: globalRole ?? (membershipForDefault?.role === "admin" ? "admin" : "user"),
    defaultTenantId,
    globalRole,
    memberships,
    twoFactorEnabled: user.twoFactorEnabled !== false,
  };
};

const getStoredUserByEmail = async (
  email: string,
): Promise<StoredUser | null> => {
  const normalized = email.trim().toLowerCase();
  const users = await readUsers();
  return users.find((user) => user.email.toLowerCase() === normalized) || null;
};

export const getUserByEmail = async (
  email: string,
): Promise<PublicUser | null> => {
  const user = await getStoredUserByEmail(email);
  return user ? toPublicUser(user) : null;
};

export const createUser = async (
  input: NewUserInput,
): Promise<PublicUser> => {
  const { email, password, name, tenantId, role = "user" } = input;
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole: UserRole =
    role === "admin" || role === "superadmin" ? role : "user";
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("El usuario ya existe");
  }

  const now = new Date().toISOString();
  const trimmedTenantId = tenantId.trim();
  const newUser: StoredUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    password: await bcrypt.hash(password, 10),
    name: name.trim(),
    defaultTenantId: trimmedTenantId,
    globalRole: normalizedRole === "superadmin" ? "superadmin" : null,
    memberships: trimmedTenantId
      ? [
          {
            tenantId: trimmedTenantId,
            role: normalizedRole === "admin" ? "admin" : "user",
          },
        ]
      : [],
    twoFactorEnabled: input.twoFactorEnabled !== false,
    createdAt: now,
  };

  const users = await readUsers();
  users.push(newUser);
  await writeUsers(users);

  return toPublicUser(newUser);
};

export const verifyUserCredentials = async (
  email: string,
  password: string,
): Promise<PublicUser | null> => {
  const user = await getStoredUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  return toPublicUser(user);
};

export const listUsers = async (): Promise<PublicUser[]> => {
  const users = await readUsers();
  return users.map(toPublicUser);
};

export const getUserById = async (
  id: string,
): Promise<PublicUser | null> => {
  const users = await readUsers();
  const user = users.find((entry) => entry.id === id);
  return user ? toPublicUser(user) : null;
};

export const updateUser = async (
  id: string,
  updates: UserUpdateInput,
): Promise<PublicUser> => {
  const users = await readUsers();
  const index = users.findIndex((entry) => entry.id === id);
  if (index === -1) {
    throw new Error("Usuario no encontrado");
  }

  const current = users[index];
  const next: StoredUser = { ...current };

  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) throw new Error("El nombre no puede estar vacío");
    next.name = trimmed;
  }

  if (updates.email !== undefined) {
    const normalized = updates.email.trim().toLowerCase();
    if (!normalized) throw new Error("El email no puede estar vacío");
    if (normalized !== current.email) {
      const clash = users.some(
        (entry) => entry.id !== id && entry.email.toLowerCase() === normalized,
      );
      if (clash) throw new Error("El email ya está en uso");
    }
    next.email = normalized;
  }

  if (updates.password !== undefined) {
    if (updates.password.length < 6) {
      throw new Error("La contraseña debe tener al menos 6 caracteres");
    }
    next.password = await bcrypt.hash(updates.password, 10);
  }

  if (updates.globalRole !== undefined) {
    const demoting =
      updates.globalRole === null && isSuperadminRecord(current);
    if (demoting && countSuperadmins(users) <= 1) {
      throw new Error("No se puede degradar al último superadmin");
    }
    next.globalRole = updates.globalRole;
  }

  if (updates.memberships !== undefined) {
    next.memberships = updates.memberships
      .filter((membership) => membership.tenantId.trim())
      .map((membership) => ({
        tenantId: membership.tenantId.trim(),
        role: membership.role === "admin" ? "admin" : "user",
      }));
  }

  if (updates.defaultTenantId !== undefined) {
    next.defaultTenantId = updates.defaultTenantId.trim();
  }

  if (updates.twoFactorEnabled !== undefined) {
    next.twoFactorEnabled = updates.twoFactorEnabled;
  }

  // Sincroniza campos legacy (tenantId/role) coherentes con memberships/globalRole
  const effectiveMemberships = next.memberships ?? [];
  const defaultMembership =
    effectiveMemberships.find(
      (membership) => membership.tenantId === next.defaultTenantId,
    ) ?? effectiveMemberships[0];

  if (next.globalRole === "superadmin") {
    next.role = "superadmin";
  } else {
    next.role = defaultMembership?.role ?? "user";
  }
  next.tenantId = defaultMembership?.tenantId ?? next.defaultTenantId ?? "";

  users[index] = next;
  await writeUsers(users);
  return toPublicUser(next);
};

export const deleteUser = async (id: string): Promise<void> => {
  const users = await readUsers();
  const target = users.find((entry) => entry.id === id);
  if (!target) {
    throw new Error("Usuario no encontrado");
  }
  if (isSuperadminRecord(target) && countSuperadmins(users) <= 1) {
    throw new Error("No se puede eliminar al último superadmin");
  }
  const filtered = users.filter((entry) => entry.id !== id);
  await writeUsers(filtered);
};
