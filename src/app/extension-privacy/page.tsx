export default function ExtensionPrivacyPage() {
  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="w-full max-w-2xl mx-auto">

        <div className="mb-8">
          <h1 className="font-serif text-3xl font-bold text-ink">
            Minute<span className="italic text-terracotta">Flow</span>
          </h1>
          <p className="mt-1 text-sm text-bark">Screen Capture Extension — Privacy Policy</p>
        </div>

        <div className="bg-white rounded-xl border border-sand p-8 shadow-sm space-y-6 text-sm text-bark leading-relaxed">

          <p className="text-xs text-bark">Last updated: May 2025</p>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">What This Extension Does</h2>
            <p>
              The MinuteFlow Screen Capture extension is a companion tool for the MinuteFlow time tracking application.
              Its sole purpose is to automatically capture a screenshot of your active browser tab when you start
              or switch tasks inside MinuteFlow, and upload that screenshot to your MinuteFlow account.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Data We Collect</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Screenshots of the <strong>active browser tab</strong> at the moment a task starts or switches</li>
              <li>Your MinuteFlow user ID (used to associate screenshots with your account)</li>
              <li>Session tokens (stored locally to keep you signed in)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Data We Do NOT Collect</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Browsing history</li>
              <li>Bookmarks</li>
              <li>Passwords or form input</li>
              <li>Screenshots of inactive tabs or other windows</li>
              <li>Any data outside of active MinuteFlow sessions</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">How Screenshots Are Used</h2>
            <p>
              Screenshots are uploaded directly to Google Drive under your organization&apos;s MinuteFlow account.
              They are linked to individual time log entries and are visible to your manager or account administrator
              as part of your activity record. Screenshots are not sold, shared with third parties, or used for
              any purpose other than time log documentation.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Permissions Explained</h2>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>activeTab</strong> — to capture only the current tab when triggered by a MinuteFlow task event</li>
              <li><strong>storage</strong> — to save your login session locally so you don&apos;t have to sign in every time</li>
              <li><strong>alarms</strong> — to schedule periodic screenshot checks during active task sessions</li>
              <li><strong>notifications</strong> — to alert you if a screenshot upload fails</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Data Retention</h2>
            <p>
              Screenshots are retained as part of your MinuteFlow time logs. Retention is governed by your
              organization&apos;s MinuteFlow account settings. You may request deletion of your data by
              contacting your MinuteFlow account administrator.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Who Has Access</h2>
            <p>
              Your screenshots are accessible to you and to your MinuteFlow account administrator (typically
              your manager or employer). MinuteFlow does not grant access to any third parties.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-base font-bold text-espresso mb-2">Contact</h2>
            <p>
              Questions about this privacy policy? Email{" "}
              <a href="mailto:noreply@minuteflow.click" className="text-terracotta hover:underline">
                noreply@minuteflow.click
              </a>
            </p>
          </section>

        </div>

        <p className="text-center text-xs text-bark mt-6">
          MinuteFlow · <a href="https://minuteflow.click" className="text-terracotta hover:underline">minuteflow.click</a>
        </p>
      </div>
    </div>
  );
}
