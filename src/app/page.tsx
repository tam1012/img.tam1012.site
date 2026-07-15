import { redirect } from "next/navigation";
import Landing from "@/components/Landing";
import { getCurrentUser } from "@/lib/auth";
import { getImagePriceVnd } from "@/lib/pricing";
import { SIGNUP_CREDIT_VND } from "@/lib/users";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/generate");

  const imagePriceVnd = getImagePriceVnd();
  const signupImages = Math.floor(SIGNUP_CREDIT_VND / imagePriceVnd);

  return <Landing imagePriceVnd={imagePriceVnd} signupImages={signupImages} />;
}
