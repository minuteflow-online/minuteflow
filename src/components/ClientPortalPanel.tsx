"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ClientPortalPanel() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);

  // Organization
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [trackMessagingTime, setTrackMessagingTime] = useState(false);
  const [orgMsg, setOrgMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [orgSaving, setOrgSaving] = useState(false);

  // Profile
  const [profileId, setProfileId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userResult } = await supabase.auth.getUser();
      const user = userResult.user;
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email ?? "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, organization_id")
        .eq("id", user.id)
        .single();
      if (profile) {
        setProfileId(profile.id);
        setFullName(profile.full_name ?? "");
        if (profile.organization_id) {
          setOrgId(profile.organization_id);
          const { data: org } = await supabase
            .from("organizations")
            .select("name, track_messaging_time")
            .eq("id", profile.organization_id)
            .single();
          if (org) {
            setOrgName(org.name ?? "");
            setTrackMessagingTime(Boolean(org.track_messaging_time));
          }
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveOrg = useCallback(async () => {
    if (!orgId || !orgName.trim()) return;
    setOrgSaving(true);
    setOrgMsg(null);
    const { error } = await supabase.from("organizations").update({ name: orgName.trim() }).eq("id", orgId);
    setOrgSaving(false);
    setOrgMsg(error ? { type: "err", text: error.message } : { type: "ok", text: "Saved." });
    setTimeout(() => setOrgMsg(null), 3000);
  }, [supabase, orgId, orgName]);

  const toggleTrackMessaging = useCallback(async () => {
    if (!orgId) return;
    const next = !trackMessagingTime;
    setTrackMessagingTime(next);
    await supabase.from("organizations").update({ track_messaging_time: next }).eq("id", orgId);
  }, [supabase, orgId, trackMessagingTime]);

  const saveProfile = useCallback(async () => {
    if (!profileId || !fullName.trim()) return;
    setProfileSaving(true);
    setProfileMsg(null);
    const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", profileId);
    setProfileSaving(false);
    setProfileMsg(error ? { type: "err", text: error.message } : { type: "ok", text: "Saved." });
    setTimeout(() => setProfileMsg(null), 3000);
  }, [supabase, profileId, fullName]);

  const handlePasswordChange = useCallback(async () => {
    if (!newPassword || newPassword.length < 6) {
      setPwMsg({ type: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "err", text: "Passwords don't match." });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) {
      setPwMsg({ type: "err", text: error.message });
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setPwMsg({ type: "ok", text: "Password updated!" });
    setTimeout(() => setPwMsg(null), 3000);
  }, [supabase, newPassword, confirmPassword]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-lg">
      {/* Organization */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Organization</h3>
        {orgMsg && (
          <p className={`text-xs font-medium ${orgMsg.type === "ok" ? "text-sage" : "text-terracotta"}`}>{orgMsg.text}</p>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Organization Name</label>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
        <button
          onClick={saveOrg}
          disabled={orgSaving}
          className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {orgSaving ? "Saving..." : "Save"}
        </button>

        <div className="flex items-center justify-between pt-2 border-t border-parchment">
          <div>
            <p className="text-[12px] font-semibold text-espresso">Track messaging time as billable</p>
            <p className="text-[11px] text-stone">Counts time your VA spends replying to you toward billable hours.</p>
          </div>
          <button
            type="button"
            onClick={toggleTrackMessaging}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${trackMessagingTime ? "bg-sage" : "bg-stone/30"}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${trackMessagingTime ? "translate-x-3.5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* My Profile */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">My Profile</h3>
        {profileMsg && (
          <p className={`text-xs font-medium ${profileMsg.type === "ok" ? "text-sage" : "text-terracotta"}`}>{profileMsg.text}</p>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Email</label>
          <input
            type="email"
            value={email}
            disabled
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-stone outline-none bg-parchment"
          />
        </div>
        <button
          onClick={saveProfile}
          disabled={profileSaving}
          className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {profileSaving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Change Password */}
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Change Password</h3>
        {pwMsg && <p className={`text-xs font-medium ${pwMsg.type === "ok" ? "text-sage" : "text-terracotta"}`}>{pwMsg.text}</p>}
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
          />
        </div>
        <button
          onClick={handlePasswordChange}
          disabled={pwSaving}
          className="px-3 py-1.5 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {pwSaving ? "Updating..." : "Update Password"}
        </button>
      </div>
    </div>
  );
}
