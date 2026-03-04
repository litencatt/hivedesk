import AppKit
import ApplicationServices

// Usage: focus-window <bundle-id> <project-dir>
let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("Usage: focus-window <bundle-id> <project-dir>\n", stderr)
    exit(1)
}

let bundleId = args[1]
let projectDir = args[2]
let projectName = URL(fileURLWithPath: projectDir).lastPathComponent

// Find the running app by bundle identifier
let runningApps = NSWorkspace.shared.runningApplications
guard let app = runningApps.first(where: { $0.bundleIdentifier == bundleId }) else {
    fputs("App not running: \(bundleId)\n", stderr)
    exit(1)
}

// Try AXUIElement to find and raise the specific window
let axApp = AXUIElementCreateApplication(app.processIdentifier)
var windowsRef: AnyObject?
let axResult = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef)

if axResult == .success, let windows = windowsRef as? [AXUIElement], !windows.isEmpty {
    // Find the window whose title contains the project name
    for window in windows {
        var titleRef: AnyObject?
        AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef)
        if let title = titleRef as? String, title.contains(projectName) {
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            app.activate(options: .activateIgnoringOtherApps)
            exit(0)
        }
    }
    // No matching window found, just activate the app
    app.activate(options: .activateIgnoringOtherApps)
    exit(0)
}

// Fallback: open the project directory with the app (same as `open -a`)
guard let appURL = app.bundleURL else { exit(1) }
let config = NSWorkspace.OpenConfiguration()
config.activates = true
NSWorkspace.shared.open(
    [URL(fileURLWithPath: projectDir)],
    withApplicationAt: appURL,
    configuration: config
) { _, error in
    exit(error == nil ? 0 : 1)
}
RunLoop.main.run(until: Date(timeIntervalSinceNow: 5))
exit(1)
