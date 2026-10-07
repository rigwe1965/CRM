import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

// bcrypt only uses the first 72 bytes, so cap the length.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

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
});

export const adminUpdateUserSchema = z
  .object({
    role: z.enum(["ADMIN", "SALES", "SUPPORT"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: "Provide role or isActive",
  });
