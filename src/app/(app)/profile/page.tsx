import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { PasswordForm, ProfileForm } from "@/components/profile/profile-forms";

export const metadata = { title: "Profile · CRM" };

export default async function ProfilePage() {
  const session = await requireUser();
  const user = await db.user.findUnique({
    where: { id: session.id },
    select: { name: true, email: true, role: true, createdAt: true, passwordHash: true },
  });
  if (!user) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Your profile</h1>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Role</dt>
            <dd className="font-medium">{user.role}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Member since</dt>
            <dd className="font-medium">{user.createdAt.toLocaleDateString("en-US")}</dd>
          </div>
        </dl>
        <hr className="border-gray-200" />
        <ProfileForm name={user.name} />
      </section>

      <section className="max-w-md space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-medium">{user.passwordHash ? "Change password" : "Set a password"}</h2>
        <PasswordForm hasPassword={!!user.passwordHash} />
      </section>
    </div>
  );
}
