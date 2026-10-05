import { redirect } from "next/navigation";

// Profile now lives under Settings; kept so old links and bookmarks still work.
export default function ProfilePage() {
  redirect("/settings");
}
