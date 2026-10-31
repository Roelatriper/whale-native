import AppKit
import ImageIO
import QuartzCore

final class PassivePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    convenience init(frame: NSRect) {
        self.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false; backgroundColor = .clear; hasShadow = false
        isReleasedWhenClosed = false; level = .floating; hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    }
}

final class PetView: NSView {
    private let sprite = CALayer()
    private let menuButton = NSButton(title: "☰", target: nil, action: nil)
    private var source: CGImageSource?, animationTimer: Timer?
    private var frameIndex = 0, frameCount = 1
    private var alpha = [UInt8](), alphaWidth = 0, alphaHeight = 0
    private var startMouse = NSPoint.zero, startWindow = NSPoint.zero
    private(set) var pressed = false
    var mirrored = false { didSet { updateTransform() } }
    var click: (() -> Void)?, contextMenu: (() -> Void)?, moved: ((NSPoint) -> Void)?, sound: ((Bool) -> Void)?
    var controls: (() -> Void)?
    var imageValid = false
    override init(frame: NSRect) {
        super.init(frame: frame); wantsLayer = true
        sprite.contentsGravity = .resizeAspect; sprite.anchorPoint = CGPoint(x: 0.5, y: 0.15)
        layer?.addSublayer(sprite)
        menuButton.target = self; menuButton.action = #selector(openControls)
        menuButton.isBordered = false; menuButton.font = .systemFont(ofSize: 17, weight: .semibold)
        menuButton.contentTintColor = .white; menuButton.wantsLayer = true
        menuButton.layer?.backgroundColor = BubbleView.color("#203170").cgColor; menuButton.layer?.cornerRadius = 6
        menuButton.isHidden = true; menuButton.setAccessibilityLabel("打开小鲸鱼控制面板"); addSubview(menuButton)
        setAccessibilityElement(true); setAccessibilityLabel("小鲸鱼原生桌宠"); setAccessibilityRole(.button)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        sprite.bounds = bounds; sprite.position = CGPoint(x: bounds.midX, y: bounds.height * 0.15)
        menuButton.frame = NSRect(x: bounds.maxX - 30, y: bounds.maxY - 30, width: 26, height: 26)
        CATransaction.commit()
        if source != nil && frameCount == 1 { showFrame() }
    }
    @objc private func openControls() { controls?() }
    func menuHit(_ point: NSPoint) -> Bool { !menuButton.isHidden && menuButton.frame.contains(point) }
    func updateHover(_ point: NSPoint) {
        menuButton.isHidden = controls == nil || !(alphaHit(point) || menuHit(point))
    }
    func load(_ data: Data) -> Bool {
        guard let image = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(image) > 0 else { return false }
        animationTimer?.invalidate(); animationTimer = nil
        source = image; frameIndex = 0; frameCount = min(120, CGImageSourceGetCount(image))
        showFrame(); imageValid = true; return true
    }
    func clear() {
        animationTimer?.invalidate(); animationTimer = nil; source = nil
        sprite.contents = nil; alpha = []; imageValid = false
    }
    private func showFrame() {
        guard let source else { return }
        let resolution = min(1024, max(360, Int(bounds.width * (window?.backingScaleFactor ?? 2))))
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false, kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: resolution]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, frameIndex, options as CFDictionary) else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true); sprite.contents = image; CATransaction.commit()
        // One 128px mask, not a cache of decoded animation frames.
        alphaWidth = 128; alphaHeight = 128
        var pixels = [UInt8](repeating: 0, count: 128 * 128 * 4)
        pixels.withUnsafeMutableBytes { raw in
            if let context = CGContext(data: raw.baseAddress, width: 128, height: 128, bitsPerComponent: 8, bytesPerRow: 128 * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                let factor = min(128 / Double(image.width), 128 / Double(image.height))
                let width = Double(image.width) * factor, height = Double(image.height) * factor
                context.draw(image, in: CGRect(x: (128 - width) / 2, y: (128 - height) / 2, width: width, height: height))
            }
        }
        alpha = stride(from: 3, to: pixels.count, by: 4).map { pixels[$0] }
        if frameCount > 1 {
            animationTimer?.invalidate()
            let properties = CGImageSourceCopyPropertiesAtIndex(source, frameIndex, nil) as? JSONObject ?? [:]
            let gif = properties[kCGImagePropertyGIFDictionary as String] as? JSONObject ?? [:]
            let png = properties[kCGImagePropertyPNGDictionary as String] as? JSONObject ?? [:]
            let delay = (gif[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double) ?? (gif[kCGImagePropertyGIFDelayTime as String] as? Double) ?? (png["UnclampedDelayTime"] as? Double) ?? (png["DelayTime"] as? Double) ?? 0.1
            animationTimer = Timer.scheduledTimer(withTimeInterval: max(0.03, delay), repeats: false) { [weak self] _ in
                guard let self else { return }; self.frameIndex = (self.frameIndex + 1) % self.frameCount; self.showFrame()
            }
        }
    }
    func pauseAnimation(_ paused: Bool) {
        animationTimer?.invalidate(); animationTimer = nil
        if !paused && frameCount > 1 { showFrame() }
    }
    func alphaHit(_ point: NSPoint) -> Bool {
        guard bounds.contains(point), alpha.count == alphaWidth * alphaHeight, bounds.width > 0 else { return false }
        let x = min(alphaWidth - 1, max(0, Int((mirrored ? bounds.width - point.x : point.x) / bounds.width * Double(alphaWidth))))
        let y = min(alphaHeight - 1, max(0, Int((bounds.height - point.y) / bounds.height * Double(alphaHeight))))
        return alpha[y * alphaWidth + x] > 10
    }
    private func updateTransform() {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        sprite.transform = CATransform3DMakeScale((mirrored ? -1 : 1) * (pressed ? 1.05 : 1), pressed ? 0.88 : 1, 1)
        CATransaction.commit()
    }
    func cancelPress() {
        guard pressed else { return }; pressed = false; updateTransform(); sound?(false)
    }
    override func mouseDown(with event: NSEvent) {
        pressed = true; startMouse = NSEvent.mouseLocation; startWindow = window?.frame.origin ?? .zero
        updateTransform(); sound?(true)
    }
    override func mouseDragged(with event: NSEvent) {
        let point = NSEvent.mouseLocation
        window?.setFrameOrigin(NSPoint(x: startWindow.x + point.x - startMouse.x, y: startWindow.y + point.y - startMouse.y))
    }
    override func mouseUp(with event: NSEvent) {
        guard pressed else { return }
        pressed = false; updateTransform(); sound?(false)
        let distance = hypot(NSEvent.mouseLocation.x - startMouse.x, NSEvent.mouseLocation.y - startMouse.y)
        if distance < 4 { click?() } else if let point = window?.frame.origin { moved?(point) }
    }
    override func rightMouseDown(with event: NSEvent) { contextMenu?() }
    deinit { animationTimer?.invalidate() }
}
