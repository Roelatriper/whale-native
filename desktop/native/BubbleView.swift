import AppKit
import QuartzCore

// Same 1026 × 700 outline, ink and inset text rectangle as .dshwv-pop.
// AppKit draws the vector directly; no resident browser or rasterized UI skin.
final class BubbleView: NSView {
    var clicked: (() -> Void)?
    var mirrored = false { didSet { needsDisplay = true; needsLayout = true } }
    let image = PetView(frame: .zero)
    private(set) var value: JSONObject = [:]
    private var rows: [JSONObject] = []
    private var outgoing: NSImageView?
    private var pending: (JSONObject, Data?, () -> Void)?
    private var transitionRevision = 0, visibilityRevision = 0
    private(set) var isTransitioning = false
    var fadeDuration: Double { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.1 : 0.18 }
    var textDuration: Double { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.1 : 0.2 }
    var visibleOpacity: Float { layer?.presentation()?.opacity ?? layer?.opacity ?? 1 }
    var outgoingOpacity: Float? { outgoing?.layer?.presentation()?.opacity ?? outgoing?.layer?.opacity }
    override var isFlipped: Bool { true }
    var contentRect: NSRect {
        NSRect(x: bounds.width * (mirrored ? 0.3075 : 0.1925), y: bounds.height * 0.1643,
               width: bounds.width * 0.5, height: bounds.height * 0.38)
    }
    override init(frame: NSRect) {
        super.init(frame: frame); wantsLayer = true; addSubview(image); image.isHidden = true
        setAccessibilityElement(true); setAccessibilityRole(.button)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func layout() { super.layout(); image.frame = contentRect; outgoing?.frame = bounds }
    // Keep one short-lived outgoing frame. The new scene is complete before
    // swapping, including decoded image bytes; no blank frame while loading.
    func transition(_ value: JSONObject, imageData: Data? = nil, animated: Bool, completion: @escaping () -> Void) {
        if isTransitioning && animated { pending = (value, imageData, completion); return }
        layoutSubtreeIfNeeded(); displayIfNeeded()
        let bitmap = animated ? bitmapImageRepForCachingDisplay(in: bounds) : nil
        if let bitmap { cacheDisplay(in: bounds, to: bitmap) }
        outgoing?.removeFromSuperview(); outgoing = nil
        update(value)
        if let imageData, !loadImage(imageData) { update(["amount": "图片暂时无法读取", "rows": [["text": "图片暂时无法读取", "size": 66]]]) }
        guard let bitmap else { completion(); return }
        let snapshot = NSImage(size: bounds.size); snapshot.addRepresentation(bitmap)
        let overlay = NSImageView(frame: bounds); overlay.image = snapshot; overlay.imageScaling = .scaleAxesIndependently
        overlay.wantsLayer = true; addSubview(overlay); outgoing = overlay
        transitionRevision += 1; let revision = transitionRevision
        isTransitioning = true
        if let layer = overlay.layer { Self.opacity(layer, to: 0, duration: textDuration) }
        DispatchQueue.main.asyncAfter(deadline: .now() + textDuration) { [weak self] in
            guard let self, self.transitionRevision == revision else { return }
            self.outgoing?.removeFromSuperview(); self.outgoing = nil; self.isTransitioning = false
            completion()
            if let next = self.pending {
                self.pending = nil
                self.transition(next.0, imageData: next.1, animated: true, completion: next.2)
            }
        }
    }
    func fade(to opacity: Float, duration: Double? = nil, completion: @escaping () -> Void = {}) {
        visibilityRevision += 1; let revision = visibilityRevision
        guard let layer else { completion(); return }
        let seconds = duration ?? fadeDuration
        Self.opacity(layer, to: opacity, duration: seconds)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self, self.visibilityRevision == revision else { return }; completion()
        }
    }
    func setOpacity(_ opacity: Float) {
        visibilityRevision += 1
        if let layer { Self.opacity(layer, to: opacity, duration: 0) }
    }
    func freezeTransition() {
        transitionRevision += 1; pending = nil; isTransitioning = false
        if let layer = outgoing?.layer { Self.opacity(layer, to: layer.presentation()?.opacity ?? layer.opacity, duration: 0) }
    }
    func resetPresentation() {
        freezeTransition(); outgoing?.removeFromSuperview(); outgoing = nil; clearMedia(); setOpacity(0)
    }
    private static func opacity(_ layer: CALayer, to target: Float, duration: Double) {
        let from = layer.presentation()?.opacity ?? layer.opacity
        layer.removeAnimation(forKey: "whale-opacity")
        CATransaction.begin(); CATransaction.setDisableActions(true); layer.opacity = target; CATransaction.commit()
        guard duration > 0 else { return }
        let animation = CABasicAnimation(keyPath: "opacity"); animation.fromValue = from; animation.toValue = target
        animation.duration = duration; animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(animation, forKey: "whale-opacity")
    }
    func update(_ value: JSONObject) {
        self.value = value; image.clear(); image.isHidden = true
        if let custom = value["rows"] as? [JSONObject] { rows = custom }
        else {
            let quota = (value["amount"] as? String ?? "").hasPrefix("5h 额度")
            rows = [("label", quota ? 58.0 : 66.0, "#536ba9"), ("amount", quota ? 88.0 : 118.0, "#536ba9"), ("hint", quota ? 62.0 : 42.0, "#9fb0d9")].compactMap { key, size, color in
                guard let text = value[key] as? String, !text.isEmpty else { return nil }
                return ["text": text, "size": size, "bold": key != "hint", "color": color]
            }
        }
        setAccessibilityLabel((value["imageRoute"] != nil ? ["小鲸鱼 petpet 动图"] : rows.compactMap { $0["text"] as? String }).joined(separator: "，"))
        needsDisplay = true; needsLayout = true
    }
    func loadImage(_ bytes: Data) -> Bool {
        let loaded = image.load(bytes); image.isHidden = !loaded; return loaded
    }
    func clearMedia() { image.clear(); image.isHidden = true }
    func paintedHit(_ point: NSPoint) -> Bool {
        guard bounds.contains(point), bounds.width > 0 else { return false }
        let scale = bounds.width / 1026
        return Self.outline().contains(NSPoint(x: (mirrored ? bounds.width - point.x : point.x) / scale, y: point.y / scale))
    }
    override func hitTest(_ point: NSPoint) -> NSView? { paintedHit(point) ? self : nil }
    override func mouseUp(with event: NSEvent) { if paintedHit(convert(event.locationInWindow, from: nil)) { clicked?() } }
    override func draw(_ dirtyRect: NSRect) {
        guard bounds.width > 0 else { return }
        NSGraphicsContext.saveGraphicsState()
        let transform = AffineTransform(translationByX: mirrored ? bounds.width : 0, byY: 0)
        var affine = transform; affine.scale(x: (mirrored ? -1 : 1) * bounds.width / 1026, y: bounds.width / 1026)
        (affine as NSAffineTransform).concat()
        let path = Self.outline(); path.lineWidth = 18; path.lineJoinStyle = .round; path.lineCapStyle = .round
        NSColor.white.setFill(); path.fill(); Self.color("#203170").setStroke(); path.stroke()
        NSGraphicsContext.restoreGraphicsState()
        guard image.isHidden else { return }
        let area = contentRect, gap = bounds.width / 1026 * 4
        var factor = 1.0
        func measured(_ factor: Double) -> [(NSAttributedString, NSSize)] {
            rows.map { row in
                let text = attributed(row, factor: factor)
                let size = text.boundingRect(with: NSSize(width: area.width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading]).size
                return (text, NSSize(width: area.width, height: ceil(size.height)))
            }
        }
        var lines = measured(factor)
        for _ in 0..<80 {
            if lines.reduce(0, { $0 + $1.1.height }) + gap * CGFloat(max(0, lines.count - 1)) <= area.height { break }
            factor *= 0.94; lines = measured(factor)
        }
        var y = area.midY - (lines.reduce(0, { $0 + $1.1.height }) + gap * CGFloat(max(0, lines.count - 1))) / 2
        for (text, size) in lines {
            text.draw(with: NSRect(x: area.minX, y: y, width: size.width, height: size.height), options: [.usesLineFragmentOrigin, .usesFontLeading])
            y += size.height + gap
        }
    }
    private func attributed(_ row: JSONObject, factor: Double) -> NSAttributedString {
        let text = row["text"] as? String ?? ""
        // Keep arithmetic in Double until the AppKit boundary. Older Swift
        // toolchains cannot infer mixed Double/CGFloat multiplication/division.
        let fontSize = CGFloat(max(1.0, (row["size"] as? Double ?? 66) * Double(bounds.width) / 1026.0 * factor))
        var font = NSFont.systemFont(ofSize: fontSize, weight: row["bold"] as? Bool == true ? .bold : .regular)
        if row["italic"] as? Bool == true { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center; paragraph.lineBreakMode = .byCharWrapping
        let result = NSMutableAttributedString(string: text, attributes: [.font: font, .foregroundColor: Self.color(row["color"] as? String ?? "#536ba9"), .paragraphStyle: paragraph,
            .underlineStyle: row["underline"] as? Bool == true ? NSUnderlineStyle.single.rawValue : 0])
        // Preserve the shipped palettes without a continuously ticking shimmer.
        let palettes = ["indigo": ["#536ba9", "#9176ca"], "rouge": ["#e0433f", "#ce86b5"], "galaxy": ["#7962b6", "#75a8d4"], "macaron": ["#d385b6", "#7bbbc2"], "candy": ["#e78fa7", "#9a86d6"]]
        if let palette = palettes[row["gradient"] as? String ?? ""] {
            let a = Self.color(palette[0]), b = Self.color(palette[1]), length = result.length
            for index in 0..<length { result.addAttribute(.foregroundColor, value: a.blended(withFraction: Double(index) / Double(max(1, length - 1)), of: b) ?? a, range: NSRange(location: index, length: 1)) }
        }
        return result
    }
    static func color(_ hex: String) -> NSColor {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0x536ba9
        return NSColor(srgbRed: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, alpha: 1)
    }
    static func outline() -> NSBezierPath {
        let path = NSBezierPath(); path.move(to: NSPoint(x: 827, y: 248))
        arc(path, to: NSPoint(x: 81, y: 246), rx: 373, ry: 232, rotation: 0, large: true)
        arc(path, to: NSPoint(x: 301, y: 465), rx: 373, ry: 232, rotation: 0, large: false)
        arc(path, to: NSPoint(x: 413, y: 484), rx: 57, ry: 32, rotation: 10, large: false)
        arc(path, to: NSPoint(x: 827, y: 248), rx: 373, ry: 232, rotation: 0, large: false)
        path.close()
        path.appendOval(in: NSRect(x: 314.5, y: 535, width: 75, height: 52))
        path.appendOval(in: NSRect(x: 417.5, y: 628, width: 49, height: 36))
        return path
    }
    // SVG endpoint arc → cubic segments (all source arcs have sweep=0).
    private static func arc(_ path: NSBezierPath, to end: NSPoint, rx originalRX: Double, ry originalRY: Double, rotation: Double, large: Bool) {
        let start = path.currentPoint, angle = rotation * .pi / 180, c = cos(angle), s = sin(angle)
        let dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2
        let x = c * dx + s * dy, y = -s * dx + c * dy
        let correction = max(1, sqrt(x * x / (originalRX * originalRX) + y * y / (originalRY * originalRY)))
        let rx = originalRX * correction, ry = originalRY * correction
        let denominator = rx * rx * y * y + ry * ry * x * x
        let factor = (large ? 1.0 : -1.0) * sqrt(max(0, (rx * rx * ry * ry - denominator) / max(1e-12, denominator)))
        let cx = factor * rx * y / ry, cy = -factor * ry * x / rx
        let center = NSPoint(x: c * cx - s * cy + (start.x + end.x) / 2, y: s * cx + c * cy + (start.y + end.y) / 2)
        let first = atan2((y - cy) / ry, (x - cx) / rx)
        var delta = atan2((-y - cy) / ry, (-x - cx) / rx) - first
        if delta > 0 { delta -= 2 * .pi }
        let count = max(1, Int(ceil(abs(delta) / (.pi / 2)))), step = delta / Double(count)
        func point(_ t: Double) -> NSPoint { NSPoint(x: center.x + c * rx * cos(t) - s * ry * sin(t), y: center.y + s * rx * cos(t) + c * ry * sin(t)) }
        func tangent(_ t: Double) -> NSPoint { NSPoint(x: -c * rx * sin(t) - s * ry * cos(t), y: -s * rx * sin(t) + c * ry * cos(t)) }
        for index in 0..<count {
            let a = first + Double(index) * step, b = a + step, k = 4 / 3 * tan(step / 4)
            let p = point(a), q = point(b), u = tangent(a), v = tangent(b)
            path.curve(to: q, controlPoint1: NSPoint(x: p.x + k * u.x, y: p.y + k * u.y), controlPoint2: NSPoint(x: q.x - k * v.x, y: q.y - k * v.y))
        }
    }
}
