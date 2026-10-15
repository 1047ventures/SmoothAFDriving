import WidgetKit
import SwiftUI

// Entry point for the Widget Extension target. @main lives here. If you add
// regular home-screen widgets later, list them alongside the Live Activity.
@main
struct SmoothAFWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            SmoothAFWidgetLiveActivity()
        }
    }
}
