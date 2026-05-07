export default function InstallPage() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-ink">
            Minute<span className="italic text-terracotta">Flow</span>
          </h1>
          <p className="mt-1 text-sm text-bark">
            Screen Capture — Quick Install
          </p>
        </div>

        <div className="bg-white rounded-xl border border-sand p-8 shadow-sm">
          <h2 className="font-serif text-xl font-bold text-espresso mb-6 text-center">
            Install Screen Capture
          </h2>

          <div className="space-y-6">
            {/* Step 1 */}
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-terracotta text-white flex items-center justify-center text-sm font-bold shrink-0">
                1
              </div>
              <div>
                <h3 className="text-sm font-bold text-espresso">Download the extension</h3>
                <p className="text-xs text-bark mt-1 mb-3">
                  Click below to download the MinuteFlow extension. After downloading, unzip the file.
                </p>
                <a
                  href="/api/download-extension"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-[#a85840] transition-colors"
                >
                  ⬇ Download Extension (.zip)
                </a>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-terracotta text-white flex items-center justify-center text-sm font-bold shrink-0">
                2
              </div>
              <div>
                <h3 className="text-sm font-bold text-espresso">Extract the zip file</h3>
                <p className="text-xs text-bark mt-1">
                  <strong>⚠️ Important:</strong> You must fully extract the zip — don&apos;t just open it.<br /><br />
                  <strong>Windows:</strong> Right-click the downloaded file &rarr; <strong>Extract All…</strong> &rarr; click <strong>Extract</strong>.<br />
                  <strong>Mac:</strong> Double-click the downloaded file to extract it.<br /><br />
                  After extracting, you should see a folder called{" "}
                  <code className="bg-parchment px-1.5 py-0.5 rounded text-terracotta text-[11px]">chrome-extension</code>.
                  That folder is what you&apos;ll load in Step 4.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-terracotta text-white flex items-center justify-center text-sm font-bold shrink-0">
                3
              </div>
              <div>
                <h3 className="text-sm font-bold text-espresso">Open Chrome Extensions</h3>
                <p className="text-xs text-bark mt-1">
                  In Chrome, type{" "}
                  <code className="bg-parchment px-1.5 py-0.5 rounded text-terracotta text-[11px]">
                    chrome://extensions
                  </code>{" "}
                  in the address bar and press Enter. Then turn on{" "}
                  <strong>Developer mode</strong> (toggle in the top right corner).
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-terracotta text-white flex items-center justify-center text-sm font-bold shrink-0">
                4
              </div>
              <div>
                <h3 className="text-sm font-bold text-espresso">Load the extension</h3>
                <p className="text-xs text-bark mt-1">
                  Click <strong>&ldquo;Load unpacked&rdquo;</strong> and select the{" "}
                  <code className="bg-parchment px-1.5 py-0.5 rounded text-terracotta text-[11px]">chrome-extension</code>{" "}
                  folder you unzipped in Step 2.
                </p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-terracotta text-white flex items-center justify-center text-sm font-bold shrink-0">
                5
              </div>
              <div>
                <h3 className="text-sm font-bold text-espresso">Sign in</h3>
                <p className="text-xs text-bark mt-1">
                  Click the puzzle piece icon in Chrome&apos;s toolbar, then click <strong>MinuteFlow</strong>.
                  Sign in with your MinuteFlow email and password. That&apos;s it — screenshots
                  will capture automatically from now on.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 p-3 rounded-lg bg-sage-soft border border-[#b5ceb8] text-xs text-espresso">
            <strong>What it does:</strong> Silently captures your active tab (not your
            full browser) when you start or switch tasks. No bookmarks, tabs, or
            personal info is ever captured.
          </div>
        </div>

        <p className="text-center text-xs text-bark mt-4">
          Questions? Contact your manager or email{" "}
          <a href="mailto:26tonitoni@gmail.com" className="text-terracotta hover:underline">
            Toni
          </a>
        </p>
      </div>
    </div>
  );
}
