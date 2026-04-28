"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const SERVICE_UNAVAILABLE = "Service temporarily unavailable. Please try again in a moment.";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export async function signIn(
  prevState: { error: string } | null,
  formData: FormData
) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  let error;
  try {
    const result = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      12000
    );
    error = result.error;
  } catch {
    return { error: SERVICE_UNAVAILABLE };
  }

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function signUp(
  prevState: { error: string } | null,
  formData: FormData
) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const username = formData.get("username") as string;
  const fullName = formData.get("full_name") as string;
  const role = formData.get("role") as string;

  if (!email || !password || !username || !fullName) {
    return { error: "All fields are required." };
  }

  let error;
  try {
    const result = await withTimeout(
      supabase.auth.signUp({
        email,
        password,
        options: { data: { username, full_name: fullName, role } },
      }),
      12000
    );
    error = result.error;
  } catch {
    return { error: SERVICE_UNAVAILABLE };
  }

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function resetPassword(
  prevState: { error: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();

  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  let error;
  try {
    const result = await withTimeout(
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback`,
      }),
      12000
    );
    error = result.error;
  } catch {
    return { error: SERVICE_UNAVAILABLE };
  }

  if (error) {
    return { error: error.message };
  }

  return { error: "", success: true };
}

export async function signOut() {
  const supabase = await createClient();
  try {
    await withTimeout(supabase.auth.signOut(), 8000);
  } catch {
    // best-effort signout
  }
  redirect("/login");
}
