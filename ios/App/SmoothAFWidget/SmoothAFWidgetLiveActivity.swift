import ActivityKit
import WidgetKit
import SwiftUI

// The Live Activity UI: Lock Screen card + Dynamic Island (compact / minimal /
// expanded). Add this file to the Widget Extension target only.
@available(iOS 16.1, *)
struct SmoothAFWidgetLiveActivity: Widget {
    // Smooth AF palette
    private let cream = Color(red: 0.95, green: 0.91, blue: 0.84)
    private let ground = Color(red: 0.04, green: 0.035, blue: 0.03)

    private func scoreColor(_ status: String) -> Color {
        switch status {
        case "smooth": return Color(red: 0.44, green: 0.71, blue: 0.41) // good
        case "rough":  return Color(red: 0.88, green: 0.36, blue: 0.23) // tang
        default:       return Color(red: 0.77, green: 0.66, blue: 0.38) // gold
        }
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DriveActivityAttributes.self) { context in
            // ── Lock Screen ──────────────────────────────────────────────
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(context.state.speedMph)").font(.system(size: 34, weight: .bold, design: .serif)).italic().foregroundStyle(cream)
                    Text("MPH").font(.system(size: 10, weight: .semibold)).kerning(1.5).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("SMOOTH AF").font(.system(size: 10, weight: .bold)).kerning(2).foregroundStyle(.secondary)
                    Text("\(context.state.score)")
                        .font(.system(size: 42, weight: .bold, design: .serif)).italic()
                        .foregroundStyle(scoreColor(context.state.status))
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .activityBackgroundTint(ground.opacity(0.92))
            .activitySystemActionForegroundColor(cream)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("mph").font(.system(size: 11)).foregroundStyle(.secondary)
                        Text("\(context.state.speedMph)").font(.system(size: 24, weight: .bold, design: .serif)).italic().foregroundStyle(cream)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("Smooth").font(.system(size: 11)).foregroundStyle(.secondary)
                        Text("\(context.state.score)").font(.system(size: 24, weight: .bold, design: .serif)).italic()
                            .foregroundStyle(scoreColor(context.state.status))
                    }
                }
            } compactLeading: {
                Text("\(context.state.speedMph)").font(.system(size: 15, weight: .bold)).foregroundStyle(cream)
            } compactTrailing: {
                Text("\(context.state.score)").font(.system(size: 15, weight: .bold)).foregroundStyle(scoreColor(context.state.status))
            } minimal: {
                Text("\(context.state.score)").font(.system(size: 13, weight: .bold)).foregroundStyle(scoreColor(context.state.status))
            }
            .widgetURL(URL(string: "smoothaf://drive"))
            .keylineTint(scoreColor(context.state.status))
        }
    }
}
