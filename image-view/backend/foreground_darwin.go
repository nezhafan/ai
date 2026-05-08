//go:build darwin && cgo

package backend

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework AppKit
#import <Cocoa/Cocoa.h>

static void ActivateImageViewApp(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSApplication *app = [NSApplication sharedApplication];
		[app setActivationPolicy:NSApplicationActivationPolicyRegular];
		[app activateIgnoringOtherApps:YES];

		NSWindow *window = [app mainWindow];
		if (window == nil) {
			window = [app keyWindow];
		}
		if (window == nil && [[app windows] count] > 0) {
			window = [[app windows] objectAtIndex:0];
		}
		if (window != nil) {
			[window deminiaturize:nil];
			[window orderFrontRegardless];
			[window makeKeyAndOrderFront:nil];
		}
	});
}
*/
import "C"

func activateNativeForeground() {
	C.ActivateImageViewApp()
}
