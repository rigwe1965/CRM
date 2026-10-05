import { redirect } from "next/navigation";
import { DEFAULT_REDIRECT } from "@/lib/rbac";

// Placeholder until the dashboard exists. Middleware sends signed-out visitors to /sign-in.
export default function Home() {
  redirect(DEFAULT_REDIRECT);
}
