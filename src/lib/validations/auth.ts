import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

// The most-guessed passwords that still satisfy "10 characters, a letter and a number".
const COMMON_PASSWORDS = new Set(
  [
    "password1", "password12", "password123", "password1234", "passw0rd123", "p@ssword123", "p@ssw0rd123",
    "qwerty12345", "qwertyuiop1", "qwerty123456", "1qaz2wsx3edc", "abc1234567", "abcd123456", "abcdefg123",
    "iloveyou123", "welcome1234", "welcome123", "letmein1234", "admin12345", "administrator1", "changeme123",
    "changeme1234", "ChangeMe123!", "monkey12345", "dragon12345", "football123", "baseball123", "sunshine123",
    "trustno1234", "master12345", "login12345", "princess123", "starwars123", "whatever123", "freedom123",
  ].map((p) => p.toLowerCase()),
);

// bcrypt only uses the first 72 bytes, so cap the length.
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "That password is too common. Choose something harder to guess")
  .refine((v) => !/^(.)\1+$/.test(v) && !/^(?:0123456789|1234567890|abcdefghij)/i.test(v), "Avoid repeated or sequential characters");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
});

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email,
  role: z.enum(["ADMIN", "SALES", "SUPPORT"]).default("SALES"),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema,
  /** Authenticator or recovery code; required when the account has two-step verification. */
  code: z.string().trim().max(40).optional(),
});

export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    role: z.enum(["ADMIN", "SALES", "SUPPORT"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.isActive !== undefined, {
    message: "Provide name, role or isActive",
  });

export const mfaCodeSchema = z.object({ code: z.string().trim().min(1, "Enter the code").max(40) });

export const mfaDisableSchema = z.object({
  password: z.string().min(1, "Password is required").max(200),
  code: z.string().trim().min(1, "Enter the code").max(40),
});

export const mfaCheckSchema = z.object({ email, password: z.string().min(1).max(200) });
