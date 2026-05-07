export default function ExtSubmitPage() {
  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="w-full max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-bold text-ink">
            Minute<span className="italic text-terracotta">Flow</span>
          </h1>
          <p className="mt-1 text-sm text-bark">Chrome Web Store — Submission Package</p>
          <p className="mt-3 text-xs text-bark bg-parchment border border-sand rounded-lg px-4 py-2 inline-block">
            🔒 Internal use only. Not linked from the app.
          </p>
        </div>

        {/* Download Section */}
        <div className="bg-white rounded-xl border border-sand p-6 shadow-sm mb-6">
          <h2 className="font-serif text-lg font-bold text-espresso mb-4">Step 1 — Download Files</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/minuteflow-extension-store.zip"
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-[#a85840] transition-colors"
            >
              ↓ Extension ZIP (for Web Store)
            </a>
            <a
              href="/minuteflow-extension.crx"
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-sand bg-white text-espresso text-sm font-semibold hover:bg-parchment transition-colors"
            >
              ↓ .CRX File (for sideloading / internal use)
            </a>
          </div>
          <p className="text-xs text-bark mt-3">
            Upload the <strong>ZIP</strong> to the Chrome Web Store developer dashboard. The .CRX is for manual installs only.
          </p>
        </div>

        {/* Store Listing Copy */}
        <div className="bg-white rounded-xl border border-sand p-6 shadow-sm mb-6">
          <h2 className="font-serif text-lg font-bold text-espresso mb-4">Step 2 — Store Listing Copy</h2>
          <p className="text-xs text-bark mb-4">Copy-paste these into the Chrome Web Store developer dashboard exactly as written.</p>

          <div className="space-y-5">
            {/* Extension Name */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Extension Name</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                MinuteFlow Screen Capture
              </div>
            </div>

            {/* Short Description */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">
                Short Description <span className="text-bark font-normal normal-case">(max 132 characters)</span>
              </label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                Automatic screenshot capture for MinuteFlow time tracking. Captures your active tab silently when tasks start or switch.
              </div>
              <p className="text-xs text-bark mt-1">118 characters ✓</p>
            </div>

            {/* Detailed Description */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Detailed Description</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all whitespace-pre-wrap leading-relaxed">
{`MinuteFlow Screen Capture is a companion extension for MinuteFlow — a time tracking app for virtual assistants.

When you start a task or switch tasks in MinuteFlow, the extension automatically takes a screenshot of your active browser tab and uploads it to your MinuteFlow time log. No buttons to click. No interruptions.

WHAT IT DOES:
• Captures the active tab when a task starts or switches
• Uploads screenshots directly to your MinuteFlow account
• Lets your manager see what you were working on during each time entry
• Works silently in the background — you'll barely notice it's there

WHAT IT DOES NOT DO:
• Does NOT capture your full screen or other windows
• Does NOT access your bookmarks, browsing history, or other tabs
• Does NOT collect any personal data beyond the active tab screenshot
• Does NOT run unless you are actively using MinuteFlow

PERMISSIONS EXPLAINED:
• activeTab — to capture the current tab only when triggered
• storage — to remember your login between sessions
• alarms — to schedule periodic captures during active tasks
• notifications — to alert you if a capture fails

This extension is intended for MinuteFlow team members only. You must have a MinuteFlow account to use it.

Privacy policy: https://minuteflow.click/extension-privacy`}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Category</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                Productivity
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Language</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                English
              </div>
            </div>

            {/* Website */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Homepage URL</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                https://minuteflow.click
              </div>
            </div>

            {/* Privacy Policy */}
            <div>
              <label className="block text-xs font-bold text-espresso mb-1 uppercase tracking-wide">Privacy Policy URL</label>
              <div className="bg-parchment rounded-lg border border-sand px-4 py-3 text-sm text-ink font-mono select-all">
                https://minuteflow.click/extension-privacy
              </div>
            </div>
          </div>
        </div>

        {/* Screenshots info */}
        <div className="bg-white rounded-xl border border-sand p-6 shadow-sm mb-6">
          <h2 className="font-serif text-lg font-bold text-espresso mb-3">Step 3 — Screenshots (Required)</h2>
          <p className="text-sm text-bark mb-3">
            Chrome Web Store requires at least <strong>1 screenshot</strong>. Required size: <strong>1280×800</strong> or <strong>640×400</strong> pixels (PNG or JPEG).
          </p>
          <div className="space-y-2 text-sm text-bark">
            <p>Suggested screenshots (take these from the MinuteFlow app):</p>
            <ol className="list-decimal list-inside space-y-1 ml-2 text-sm">
              <li>The MinuteFlow dashboard while a task is active (shows the extension is working)</li>
              <li>The Activity Log showing a screenshot thumbnail in a time entry</li>
              <li>The extension popup showing the connected/signed-in state</li>
            </ol>
            <p className="text-xs mt-3 bg-parchment border border-sand rounded-lg px-3 py-2">
              <strong>Note:</strong> You can use Chrome DevTools to capture screenshots at the exact required dimensions, or use a tool like Figma/Canva to compose them.
            </p>
          </div>
        </div>

        {/* Submission Checklist */}
        <div className="bg-white rounded-xl border border-sand p-6 shadow-sm mb-6">
          <h2 className="font-serif text-lg font-bold text-espresso mb-3">Step 4 — Submission Checklist for Jojo</h2>
          <div className="space-y-3 text-sm text-bark">
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Go to <a href="https://chrome.google.com/webstore/devconsole" target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline">chrome.google.com/webstore/devconsole</a> and sign in with a Google account</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Pay the one-time <strong>$5 developer registration fee</strong> (only needed once)</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Click <strong>"New Item"</strong> and upload the <strong>Extension ZIP</strong> downloaded above</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Fill in the store listing using the copy in Step 2 above</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Upload at least 1 screenshot (1280×800 or 640×400 — see Step 3)</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Under <strong>Visibility</strong>, set to <strong>"Unlisted"</strong> — only people with the direct link can install it. No public discovery.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Click <strong>Submit for Review</strong>. Google usually reviews in 1–3 business days.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-5 h-5 rounded border border-sand flex items-center justify-center text-xs">□</span>
              <span>Once approved, share the Web Store install link with Toni to send to VAs</span>
            </div>
          </div>

          <div className="mt-5 p-3 rounded-lg bg-[#fdf6f0] border border-[#e8d5c8] text-xs text-espresso">
            <strong>Why "Unlisted"?</strong> Unlisted means the extension won&apos;t appear in Web Store search results — only people with the direct link can install it. This keeps it private to MinuteFlow VAs while still letting Chrome trust it (no more security warnings).
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-bark mt-6">
          Prepared by Manny · MinuteFlow internal use only
        </p>
      </div>
    </div>
  );
}
