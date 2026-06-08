"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

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

  // Only invited emails can register
  const normalizedEmail = email.toLowerCase().trim();
  const { data: invite, error: inviteCheckError } = await supabase
    .from("invitations")
    .select("id")
    .eq("email", normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (inviteCheckError) {
    return { error: SERVICE_UNAVAILABLE };
  }

  if (!invite) {
    return {
      error:
        "Only invited users can register. Please contact your admin to request an invitation.",
    };
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
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://minuteflow.click";

  // Use admin client to generate a recovery link
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let actionLink: string;
  try {
    const result = await withTimeout(
      adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${siteUrl}/auth/confirm` },
      }),
      12000
    );
    if (result.error) {
      return { error: result.error.message };
    }
    actionLink = result.data.properties.action_link;
  } catch {
    return { error: SERVICE_UNAVAILABLE };
  }

  // Send via Resend instead of Supabase's built-in email
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { error: SERVICE_UNAVAILABLE };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MinuteFlow <noreply@minuteflow.click>",
        to: [email],
        subject: "Reset your MinuteFlow password",
        html: buildPasswordResetEmail(actionLink),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend password reset error:", err);
      return { error: "Failed to send reset email. Please try again." };
    }
  } catch {
    return { error: SERVICE_UNAVAILABLE };
  }

  return { error: "", success: true };
}

export async function updatePassword(
  prevState: { error: string; success?: boolean } | null,
  formData: FormData
) {
  const supabase = await createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!password) return { error: "Password is required." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (password !== confirmPassword) return { error: "Passwords do not match." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect("/dashboard");
}

function buildPasswordResetEmail(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 480px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">
      <div style="padding: 28px 32px; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 4px;">MinuteFlow</div>
        <div style="font-size: 22px; font-weight: 700; color: #c0704e;">Reset Your Password</div>
      </div>
      <div style="padding: 28px 32px;">
        <p style="font-size: 14px; color: #3d2b1f; line-height: 1.6; margin: 0 0 24px;">
          We received a request to reset your MinuteFlow password. Click the button below to set a new password.
        </p>
        <a href="${resetLink}" style="display: inline-block; background: #c0704e; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none;">
          Reset Password
        </a>
        <p style="font-size: 12px; color: #9e9080; margin: 24px 0 0; line-height: 1.6;">
          This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
      <div style="padding: 16px 32px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">MinuteFlow · noreply@minuteflow.click</div>
      </div>
    </div>
  </div>
</body>
</html>`;
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
