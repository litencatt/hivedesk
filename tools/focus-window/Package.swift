// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "focus-window",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "focus-window",
            path: "Sources"
        )
    ]
)
