import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export type UserRole = "user" | "admin" | "superadmin";

export type StoredUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  tenantId: string;
  role: UserRole;
  createdAt: string;
};

export type PublicUser = Omit<StoredUser, "password">;

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

export const getUserByEmail = async (
  email: string,
): Promise<StoredUser | null> => {
  const normalized = email.trim().toLowerCase();
  const users = await readUsers();
  return users.find((u) => u.email.toLowerCase() === normalized) || null;
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
  const hashed = await bcrypt.hash(password, 10);
  const newUser: StoredUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    password: hashed,
    name: name.trim(),
    tenantId: tenantId.trim(),
    role: normalizedRole,
    createdAt: now,
  };

  const users = await readUsers();
  users.push(newUser);
  await writeUsers(users);

  const { password: _, ...publicUser } = newUser;
  return publicUser;
};

export const verifyUserCredentials = async (
  email: string,
  password: string,
): Promise<PublicUser | null> => {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  const { password: _, ...publicUser } = user;
  return publicUser;
};

export const listUsers = async (): Promise<PublicUser[]> => {
  const users = await readUsers();
  return users.map(({ password: _pwd, ...rest }) => rest);
};
