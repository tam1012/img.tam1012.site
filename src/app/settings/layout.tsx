import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await requireAdmin())) {
    redirect("/generate");
  }
  return <>{children}</>;
}
