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
  createdAt: string;
};

export type PublicUser = Omit<StoredUser, "password"> & {
  tenantId: string;
  role: UserRole;
  defaultTenantId: string;
  globalRole: "superadmin" | null;
  memberships: TenantMembership[];
};

type NewUserInput = {
  email: string;
  password: string;
  name: string;
  tenantId: string;
  role?: UserRole;
};

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
