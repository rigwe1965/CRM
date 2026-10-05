import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { signUpSchema } from "@/lib/validations/auth";

export async function POST(req: Request) {
  const body = await parseBody(req, signUpSchema);
  if ("response" in body) return body.response;
  const { name, email, password } = body.data;

  try {
    // Role is never taken from the client: new accounts are SALES (schema default).
    await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return apiError("An account with this email already exists", 409, {
        email: ["An account with this email already exists"],
      });
    }
    console.error("register failed", e);
    return apiError("Could not create account. Please try again.", 500);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
