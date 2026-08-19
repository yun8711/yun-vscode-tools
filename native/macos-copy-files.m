#import <AppKit/AppKit.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      return 1;
    }

    NSMutableArray<NSPasteboardItem *> *items = [NSMutableArray array];
    NSMutableArray<NSString *> *paths = [NSMutableArray array];

    for (int i = 1; i < argc; i++) {
      NSString *path = [NSString stringWithUTF8String:argv[i]];
      NSURL *url = [NSURL fileURLWithPath:path];
      NSPasteboardItem *item = [[NSPasteboardItem alloc] init];

      // 写入 Finder/聊天软件更容易识别的文件 URL 类型，而不是普通路径文本。
      [item setString:[url absoluteString] forType:NSPasteboardTypeFileURL];
      [items addObject:item];
      [paths addObject:path];
    }

    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];

    BOOL wroteFileUrls = [pasteboard writeObjects:items];

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    // 兼容部分仍读取旧 Finder 文件列表类型的应用。
    BOOL wroteFinderPaths = [pasteboard setPropertyList:paths forType:NSFilenamesPboardType];
#pragma clang diagnostic pop

    return (wroteFileUrls || wroteFinderPaths) ? 0 : 2;
  }
}
