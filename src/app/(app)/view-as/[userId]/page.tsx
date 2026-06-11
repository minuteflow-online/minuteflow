import { redirect } from "next/navigation";

// View As has been replaced with Log In As.
export default async function ViewAsRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/login-as/${userId}`);
}
