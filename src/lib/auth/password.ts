import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

export interface PasswordStrength {
  valid: boolean;
  errors: string[];
}

/** Server side password policy (mirrored by the zod schema for user feedback). */
export function checkPasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Kata sandi minimal 8 karakter.");
  if (password.length > 72) errors.push("Kata sandi maksimal 72 karakter.");
  if (!/[A-Za-z]/.test(password)) errors.push("Kata sandi harus memuat minimal satu huruf.");
  if (!/[0-9]/.test(password)) errors.push("Kata sandi harus memuat minimal satu angka.");
  return { valid: errors.length === 0, errors };
}
