import ActivityKit
import Foundation

// The data model for the drive Live Activity. Add this file to BOTH the App
// target and the Widget Extension target (they share it).
@available(iOS 16.1, *)
struct DriveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var score: Int        // live Smooth AF score 0–100
        var speedMph: Int
        var status: String    // "smooth" | "ok" | "rough" — drives the colour
    }

    var startedAt: Date
}
