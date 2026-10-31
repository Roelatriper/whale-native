import AppKit

func option(_ key: String, _ fallback: String) -> String {
    guard let index = CommandLine.arguments.firstIndex(of: key), index + 1 < CommandLine.arguments.count else { return fallback }
    return CommandLine.arguments[index + 1]
}
let config = (try? Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/launch.json")))
    .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
let bundled = config["mode"] == "bundled"
let resources = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources")
let environment = ProcessInfo.processInfo.environment
let codexHome = environment["CODEX_HOME"] ?? NSHomeDirectory() + "/.codex"
let defaultData = environment["WHALE_HOME"] ?? codexHome + "/whale-widget"
let root = URL(fileURLWithPath: option("--root", bundled ? resources.appendingPathComponent("app").path : config["root"] ?? FileManager.default.currentDirectoryPath))
let node = URL(fileURLWithPath: option("--node", bundled ? Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node").path : config["node"] ?? "/opt/homebrew/bin/node"))
let data = URL(fileURLWithPath: option("--data-dir", bundled ? defaultData : config["dataDir"] ?? defaultData))
try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
let app = NSApplication.shared
let delegate = MainActor.assumeIsolated {
    NativeApplication(root: root, node: node, data: data, fixture: CommandLine.arguments.contains("--fixture"), selfTest: CommandLine.arguments.contains("--self-test"))
}
app.delegate = delegate
app.run()
