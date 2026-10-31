import AppKit
import QuartzCore

@MainActor final class NativeApplication: NSObject, NSApplicationDelegate {
    let root: URL, node: URL, data: URL
    let fixture: Bool, selfTest: Bool
    let backend = BackendConnection()
    let petPanel = PassivePanel(frame: NSRect(x: 100, y: 100, width: 180, height: 180))
    let pet = PetView(frame: NSRect(x: 0, y: 0, width: 180, height: 180))
    let bubblePanel = PassivePanel(frame: NSRect(x: 100, y: 300, width: 320, height: 154))
    let bubble = BubbleView(frame: NSRect(x: 0, y: 0, width: 320, height: 154))
    let audio: PetAudio
    var settings: NativeSettings?, statusItem: NSStatusItem?
    var snapshot: JSONObject = [:], preferences: JSONObject = [:]
    var ready = false, manuallyHidden = false, terminating = false, shutdownComplete = false, loadedRole = "", lastHost: NSRect?
    var appliedFollowMode = "", releasedSince: Date?
    var closeBubble: Timer?, inputTimer: Timer?, followTimer: Timer?, diagnosticTimer: Timer?
    var globalClick: Any?, localClick: Any?, globalMove: Any?
    var notices: [JSONObject] = [], noticeActive = false
    var bubbleRevision = 0
    var conversationOpen = false, bubbleClosing = false

    init(root: URL, node: URL, data: URL, fixture: Bool, selfTest: Bool) {
        self.root = root; self.node = node; self.data = data; self.fixture = fixture; self.selfTest = selfTest
        audio = PetAudio(root: root)
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        petPanel.title = "Whale Native Pet"; bubblePanel.title = "Whale Native Bubble"
        petPanel.acceptsMouseMovedEvents = true
        petPanel.contentView = pet; bubblePanel.contentView = bubble
        pet.click = { [weak self] in self?.toggleBubble() }
        pet.contextMenu = { [weak self] in self?.showPetMenu() }
        pet.controls = { [weak self] in self?.openSettings() }
        pet.moved = { [weak self] point in
            guard let self else { return }; let clamped = self.clamp(point); self.petPanel.setFrameOrigin(clamped)
            self.action("preferences", ["position": ["x": clamped.x, "y": clamped.y]])
        }
        pet.sound = { [weak self] pressed in if pressed { self?.audio.press() } else { self?.audio.release() } }
        bubble.clicked = { [weak self] in
            guard let self, !self.bubbleClosing else { return }
            if self.noticeActive { self.hideBubble() } else { self.conversation("bubble-next") }
        }
        backend.event = { [weak self] name, value in self?.event(name, value) }
        backend.exited = { [weak self] code in
            guard let self, !self.terminating else { return }
            self.ready = false; self.present(["label": "后台连接已断开", "amount": "请从菜单退出后重新启动", "hint": "退出状态：\(code)"])
            self.writeStatus()
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "🐳"; updateMenu()
        inputTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.routeMouse() } }
        followTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.followHost() } }
        diagnosticTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.writeStatus() } }
        globalClick = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.dismissOutside() }
        globalMove = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in self?.routeMouse() }
        localClick = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            if event.window !== self?.bubblePanel && event.window !== self?.petPanel { self?.dismissOutside() }; return event
        }
        do { try backend.start(root: root, node: node, data: data, fixture: fixture) }
        catch { present(["label": "原生后台无法启动", "amount": "请检查 Node.js 与启动配置", "hint": error.localizedDescription]); writeStatus() }
    }
    func event(_ name: String, _ value: JSONObject) {
        switch name {
        case "ready": ready = true; writeStatus(); if selfTest { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.runSmoke() } }
        case "snapshot":
            if let mode = value["mode"] as? String, let old = snapshot["mode"] as? String, mode != old { invalidateNotices() }
            let first = preferences.isEmpty; snapshot = value
            if let next = value["preferences"] as? JSONObject { preferences = next }
            if preferences["taskNotices"] as? Bool == false && noticeActive { invalidateNotices() }
            applyPreferences(first: first); updateMenu(); writeStatus()
        case "notice":
            if notices.count >= 16, let index = notices.firstIndex(where: { $0["kind"] as? String != "account" }) { notices.remove(at: index) }
            if notices.count < 16 { notices.append(value) }
            showNextNotice()
        case "invalidate-notices": invalidateNotices()
        case "show": manuallyHidden = false; if value["resetPosition"] as? Bool == true { placeDefault() }; followHost()
        case "shutdown": NSApp.terminate(nil)
        case "error": present(["label": "小鲸鱼", "amount": value["message"] as? String ?? "后台暂不可用", "hint": "请检查设置后刷新"])
        default: break
        }
    }
    func action(_ name: String, _ args: JSONObject = [:]) {
        backend.call("action", ["name": name, "args": args]) { [weak self] result in
            if case .failure = result { self?.present(["label": "操作未完成", "amount": "请稍后重试", "hint": "已有数据未被替换"]) }
        }
    }
    func applyPreferences(first: Bool) {
        let scale = preferences["scale"] as? Double ?? 1, size = 250 * 0.5945 * scale
        if abs(petPanel.frame.width - size) > 0.1 { petPanel.setContentSize(NSSize(width: size, height: size)); pet.frame = NSRect(x: 0, y: 0, width: size, height: size) }
        petPanel.setFrameOrigin(clamp(petPanel.frame.origin))
        let followMode = preferences["followMode"] as? String ?? "standalone"
        if followMode != appliedFollowMode { appliedFollowMode = followMode; lastHost = nil }
        pet.mirrored = preferences["flipped"] as? Bool ?? false
        bubble.mirrored = pet.mirrored
        let bubbleWidth = 250 * scale
        bubblePanel.setContentSize(NSSize(width: bubbleWidth, height: bubbleWidth * 700 / 1026)); bubble.frame = NSRect(origin: .zero, size: bubblePanel.frame.size)
        audio.enabled = !fixture && (preferences["sound"] as? Bool ?? true); audio.volume = Float(preferences["volume"] as? Double ?? 0.6); audio.set = preferences["soundSet"] as? String ?? "duck"
        if first {
            if let point = preferences["position"] as? JSONObject, let x = point["x"] as? Double, let y = point["y"] as? Double { petPanel.setFrameOrigin(clamp(NSPoint(x: x, y: y))) }
            else { placeDefault() }
        }
        let role = preferences["role"] as? String ?? "default"
        if role != loadedRole {
            loadedRole = role
            backend.resource(role == "default" ? "/dsh-whale/image.png" : "/dsh-whale/role-image.png?id=" + role) { [weak self] result in
                guard let self, self.loadedRole == role else { return }
                if case let .success((bytes, _, status)) = result, status == 200, self.pet.load(bytes) { self.followHost(); self.writeStatus() }
                else if let bytes = try? Data(contentsOf: self.root.appendingPathComponent("assets/DSniang1.png")) { _ = self.pet.load(bytes); self.followHost(); self.writeStatus() }
            }
        }
        followHost(); positionBubble()
    }
    func clamp(_ point: NSPoint) -> NSPoint {
        let size = petPanel.frame.size
        let screen = NSScreen.screens.first { $0.visibleFrame.contains(point) } ?? NSScreen.main ?? NSScreen.screens.first
        guard let area = screen?.visibleFrame else { return point }
        return NSPoint(x: min(max(point.x, area.minX), area.maxX - size.width), y: min(max(point.y, area.minY), area.maxY - size.height))
    }
    func placeDefault() {
        let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1000, height: 700)
        petPanel.setFrameOrigin(NSPoint(x: area.maxX - petPanel.frame.width - 36, y: area.minY + 36)); lastHost = nil
    }
    func routeMouse() {
        guard petPanel.isVisible else { return }
        if pet.pressed && NSEvent.pressedMouseButtons & 1 == 0 {
            if let releasedSince, Date().timeIntervalSince(releasedSince) > 0.2 { pet.cancelPress(); self.releasedSince = nil }
            else if releasedSince == nil { releasedSince = Date() }
        } else { releasedSince = nil }
        let local = NSPoint(x: NSEvent.mouseLocation.x - petPanel.frame.minX, y: NSEvent.mouseLocation.y - petPanel.frame.minY)
        pet.updateHover(local)
        petPanel.ignoresMouseEvents = !pet.pressed && !pet.alphaHit(local) && !pet.menuHit(local)
        let bubblePoint = NSPoint(x: NSEvent.mouseLocation.x - bubblePanel.frame.minX, y: bubblePanel.frame.maxY - NSEvent.mouseLocation.y)
        bubblePanel.ignoresMouseEvents = !bubble.paintedHit(bubblePoint)
        if pet.pressed { positionBubble() }
    }
    func followHost() {
        guard ready, pet.imageValid else { return }
        if manuallyHidden { setVisible(false); return }
        if preferences["followMode"] as? String != "follow-codex" { setVisible(true); return }
        let ids = Set(NSRunningApplication.runningApplications(withBundleIdentifier: ProcessInfo.processInfo.environment["WHALE_CODEX_BUNDLE_ID"] ?? "com.openai.codex").map { $0.processIdentifier })
        let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [JSONObject] ?? []
        guard let row = rows.first(where: { ids.contains(($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0) && ($0[kCGWindowLayer as String] as? Int ?? -1) == 0 && (($0[kCGWindowBounds as String] as? JSONObject)?["Width"] as? Double ?? 0) >= 320 && (($0[kCGWindowBounds as String] as? JSONObject)?["Height"] as? Double ?? 0) >= 200 }),
              let raw = row[kCGWindowBounds as String] as? JSONObject,
              let cgRect = CGRect(dictionaryRepresentation: raw as CFDictionary) else { setVisible(false); return }
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let area = NSRect(x: cgRect.minX, y: top - cgRect.maxY, width: cgRect.width, height: cgRect.height)
        if let previous = lastHost, !pet.pressed { petPanel.setFrameOrigin(clamp(NSPoint(x: petPanel.frame.minX + area.minX - previous.minX, y: petPanel.frame.minY + area.minY - previous.minY))) }
        else if lastHost == nil && (preferences["position"] is NSNull || preferences["position"] == nil) { petPanel.setFrameOrigin(clamp(NSPoint(x: area.maxX - petPanel.frame.width - 16, y: area.minY + 20))) }
        lastHost = area; setVisible(true)
    }
    func setVisible(_ visible: Bool) {
        if visible && !petPanel.isVisible { petPanel.orderFrontRegardless(); pet.pauseAnimation(false); showNextNotice() }
        else if !visible && petPanel.isVisible { pet.cancelPress(); petPanel.orderOut(nil); hideBubble(animated: false); pet.pauseAnimation(true) }
    }
    func positionBubble() {
        let area = NSScreen.screens.first { $0.frame.intersects(petPanel.frame) }?.visibleFrame ?? NSScreen.main?.visibleFrame ?? petPanel.frame
        let width = bubblePanel.frame.width, height = bubblePanel.frame.height
        let anchor = pet.mirrored ? petPanel.frame.minX : petPanel.frame.maxX - width
        let x = min(max(anchor, area.minX + 8), max(area.minX + 8, area.maxX - width - 8))
        let y = min(max(petPanel.frame.minY + width - height, area.minY + 8), max(area.minY + 8, area.maxY - height - 8))
        bubblePanel.setFrameOrigin(NSPoint(x: x, y: y))
    }
    func present(_ text: JSONObject, accountId: String? = nil) {
        guard !manuallyHidden else { return }
        if text["closed"] as? Bool == true { hideBubble(); return }
        bubbleRevision += 1
        let revision = bubbleRevision
        closeBubble?.invalidate(); closeBubble = nil
        if let route = text["imageRoute"] as? String {
            backend.resource(route) { [weak self] result in
                guard let self, self.bubbleRevision == revision, !self.manuallyHidden else { return }
                if case let .success((bytes, _, status)) = result, status == 200 { self.commitBubble(text, imageData: bytes, revision: revision, accountId: accountId) }
                else { self.commitBubble(["rows": [["text": "图片暂时无法读取", "size": 66]], "amount": "图片暂时无法读取"], revision: revision, accountId: accountId) }
            }
        } else { commitBubble(text, revision: revision, accountId: accountId) }
    }
    func commitBubble(_ text: JSONObject, imageData: Data? = nil, revision: Int, accountId: String?) {
        let opening = !bubblePanel.isVisible || bubbleClosing
        let replacing = bubblePanel.isVisible
        if !bubblePanel.isVisible { bubble.setOpacity(0) }
        bubbleClosing = false; positionBubble(); bubblePanel.orderFrontRegardless()
        if opening { bubble.fade(to: 1) }
        bubble.transition(text, imageData: imageData, animated: replacing) { [weak self] in
            guard let self, self.bubbleRevision == revision, !self.bubbleClosing else { return }
            if opening && !replacing {
                DispatchQueue.main.asyncAfter(deadline: .now() + self.bubble.fadeDuration) { [weak self] in self?.bubbleDidPresent(revision, accountId: accountId) }
            } else { self.bubbleDidPresent(revision, accountId: accountId) }
        }
        writeStatus()
    }
    func bubbleDidPresent(_ revision: Int, accountId: String?) {
        guard bubbleRevision == revision, !bubbleClosing, bubblePanel.isVisible else { return }
        // Do not consume a notice while it is still transparent/transitioning.
        if let accountId, petPanel.isVisible { action("ack-account", ["id": accountId]) }
        closeBubble?.invalidate(); closeBubble = nil
        let seconds = preferences["bubbleSeconds"] as? Double ?? 8
        if seconds > 0 { closeBubble = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.hideBubble() } } }
        writeStatus()
    }
    func toggleBubble() {
        guard !noticeActive else { return }
        let name = conversationOpen ? "bubble-pet" : "bubble-open"
        conversationOpen = true; conversation(name)
    }
    func conversation(_ name: String) {
        bubbleRevision += 1; let revision = bubbleRevision
        closeBubble?.invalidate(); closeBubble = nil
        backend.call("action", ["name": name]) { [weak self] result in
            guard let self, self.bubbleRevision == revision else { return }
            if case let .success(text) = result { self.present(text) }
            else if self.bubbleClosing { self.hideBubble(animated: false) }
            else if self.bubblePanel.isVisible { self.bubbleDidPresent(revision, accountId: nil) }
            else { self.conversationOpen = false }
        }
    }
    func hideBubble(animated: Bool = true) {
        bubbleRevision += 1; let revision = bubbleRevision
        conversationOpen = false; bubbleClosing = true; bubble.freezeTransition()
        closeBubble?.invalidate(); closeBubble = nil
        let finish = { [weak self] in
            guard let self, self.bubbleRevision == revision else { return }
            self.bubblePanel.orderOut(nil); self.bubble.resetPresentation(); self.bubbleClosing = false; self.noticeActive = false
            self.writeStatus(); self.showNextNotice()
        }
        if animated && bubblePanel.isVisible { bubble.fade(to: 0, duration: bubble.fadeDuration, completion: finish) }
        else { finish() }
    }
    func invalidateNotices() {
        notices.removeAll(); noticeActive = false; hideBubble(animated: false)
    }
    func dismissOutside() {
        let point = NSEvent.mouseLocation
        let petPoint = NSPoint(x: point.x - petPanel.frame.minX, y: point.y - petPanel.frame.minY)
        let bubblePoint = NSPoint(x: point.x - bubblePanel.frame.minX, y: bubblePanel.frame.maxY - point.y)
        if preferences["outsideDismiss"] as? Bool == true && bubblePanel.isVisible && !pet.alphaHit(petPoint) && !pet.menuHit(petPoint) && !bubble.paintedHit(bubblePoint) { hideBubble() }
    }
    func showNextNotice() {
        guard petPanel.isVisible, !noticeActive, !bubblePanel.isVisible, !notices.isEmpty else { return }
        let notice = notices.removeFirst(); noticeActive = true
        present(notice["display"] as? JSONObject ?? [:], accountId: notice["accountId"] as? String)
    }
    func menu() -> NSMenu {
        let menu = NSMenu()
        func add(_ label: String, _ action: Selector, value: Any? = nil, checked: Bool = false) {
            let item = NSMenuItem(title: label, action: action, keyEquivalent: ""); item.target = self; item.representedObject = value; item.state = checked ? .on : .off; menu.addItem(item)
        }
        add("原生版 · 第一阶段", #selector(noop)); menu.addItem(.separator())
        add("API 余额", #selector(setMode(_:)), value: "api", checked: snapshot["mode"] as? String == "api")
        add("Codex 订阅", #selector(setMode(_:)), value: "subscription", checked: snapshot["mode"] as? String == "subscription")
        add("刷新额度", #selector(refresh)); add("设置与账本…", #selector(openSettings))
        let roles = NSMenu(); let roleItem = NSMenuItem(title: "切换角色", action: nil, keyEquivalent: "")
        for role in snapshot["roles"] as? [JSONObject] ?? [] {
            let item = NSMenuItem(title: role["name"] as? String ?? "角色", action: #selector(setRole(_:)), keyEquivalent: ""); item.target = self; item.representedObject = role["id"]; item.state = role["id"] as? String == loadedRole ? .on : .off; roles.addItem(item)
        }
        roleItem.submenu = roles; menu.addItem(roleItem); menu.addItem(.separator())
        add("独立桌面", #selector(setFollow(_:)), value: "standalone", checked: preferences["followMode"] as? String == "standalone")
        add("跟随 Codex", #selector(setFollow(_:)), value: "follow-codex", checked: preferences["followMode"] as? String == "follow-codex")
        add("显示 / 隐藏小鲸鱼", #selector(toggleVisible)); add("恢复默认位置", #selector(resetPosition))
        menu.addItem(.separator()); add("退出原生版", #selector(quit)); return menu
    }
    func updateMenu() { statusItem?.menu = menu() }
    func showPetMenu() { menu().popUp(positioning: nil, at: NSPoint(x: pet.bounds.midX, y: pet.bounds.midY), in: pet) }
    @objc func noop() {}
    @objc func setMode(_ item: NSMenuItem) { action("mode", ["mode": item.representedObject as? String ?? "api"]) }
    @objc func setRole(_ item: NSMenuItem) { action("preferences", ["role": item.representedObject as? String ?? "default"]) }
    @objc func setFollow(_ item: NSMenuItem) { lastHost = nil; action("preferences", ["followMode": item.representedObject as? String ?? "standalone"]) }
    @objc func refresh() { action("refresh") }
    @objc func openSettings() {
        if settings == nil {
            settings = NativeSettings(backend: backend)
            settings?.closed = { [weak self] in self?.settings = nil; self?.writeStatus() }
        }
        settings?.show(); writeStatus()
    }
    @objc func toggleVisible() { manuallyHidden.toggle(); followHost(); writeStatus() }
    @objc func resetPosition() { placeDefault(); action("preferences", ["position": NSNull()]); manuallyHidden = false; followHost() }
    @objc func quit() { NSApp.terminate(nil) }
    func writeStatus() {
        let status: JSONObject = ["schema": 1, "stage": 1, "renderer": "appkit", "appPid": ProcessInfo.processInfo.processIdentifier,
            "backendPid": backend.process.isRunning ? backend.process.processIdentifier : 0, "ready": ready,
            "petVisible": petPanel.isVisible, "bubbleVisible": bubblePanel.isVisible, "settingsOpen": settings != nil,
            "imageValid": pet.imageValid, "pressed": pet.pressed, "focusablePet": petPanel.canBecomeKey,
            "pendingNotices": notices.count, "manuallyHidden": manuallyHidden, "bubbleClosing": bubbleClosing,
            "bubbleTransitioning": bubble.isTransitioning, "at": ISO8601DateFormatter().string(from: Date())]
        if let bytes = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted, .sortedKeys]) { try? bytes.write(to: data.appendingPathComponent("native-status.json"), options: .atomic) }
    }
    func runSmoke() {
        guard fixture else { return }
        let deadline = Date().addingTimeInterval(20)
        @MainActor func capture(_ view: NSView, _ filename: String) {
            view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
            if let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
                if let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: data.appendingPathComponent(filename)) }
            }
        }
        @MainActor func finish(_ result: JSONObject) {
            if let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) { try? bytes.write(to: self.data.appendingPathComponent("native-smoke.json"), options: .atomic) }
            NSApp.terminate(nil)
        }
        @MainActor func probe() {
            guard ready, pet.imageValid, !snapshot.isEmpty else {
                if Date() < deadline { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { probe() } }
                else { finish(["ok": false, "error": "native startup timeout"] ) }; return
            }
            var checks = ["real Node dispatcher handshake", "native image decoded", "pet and bubble cannot become key windows"]
            guard Bundle.main.bundleURL.lastPathComponent == "whale-native.app",
                  Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String == "whale-native",
                  Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String == "whale-native.icns",
                  let icon = Bundle.main.url(forResource: "whale-native", withExtension: "icns"),
                  (try? Data(contentsOf: icon).prefix(4)) == Data("icns".utf8) else { finish(["ok": false, "error": "native name/icon metadata invalid"]); return }
            checks.append("whale-native.app bundle name and default pet ICNS are installed")
            guard !petPanel.canBecomeKey && !bubblePanel.canBecomeKey else { finish(["ok": false, "error": "passive panels can focus"]); return }
            var hits = 0
            for x in stride(from: 0.0, to: pet.bounds.width, by: 8) { for y in stride(from: 0.0, to: pet.bounds.height, by: 8) { if pet.alphaHit(NSPoint(x: x, y: y)) { hits += 1 } } }
            guard hits > 0, !pet.alphaHit(NSPoint(x: -10, y: -10)) else { finish(["ok": false, "error": "alpha hit mask invalid"]); return }
            checks.append("native alpha mask has opaque pixels and rejects outside points")
            if let down = NSEvent.mouseEvent(with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: petPanel.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1),
               let up = NSEvent.mouseEvent(with: .leftMouseUp, location: .zero, modifierFlags: [], timestamp: 1, windowNumber: petPanel.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 0) {
                for _ in 0..<3 {
                    pet.mouseDown(with: down)
                    guard pet.pressed else { finish(["ok": false, "error": "native press not held"]); return }
                    pet.mouseUp(with: up)
                    guard !pet.pressed else { finish(["ok": false, "error": "native press did not release"]); return }
                }
                checks.append("three direct native press/release sequences update held state")
            }
            let focusedBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
            present(snapshot["display"] as? JSONObject ?? [:]); guard bubblePanel.isVisible else { finish(["ok": false, "error": "bubble not visible"]); return }
            guard focusedBefore == NSWorkspace.shared.frontmostApplication?.processIdentifier else { finish(["ok": false, "error": "bubble changed frontmost application"]); return }
            checks.append("native quota bubble renders without a webview")
            capture(pet, "native-pet.png"); capture(bubble, "native-bubble.png")
            guard bubble.paintedHit(NSPoint(x: bubble.bounds.width * 0.4425, y: bubble.bounds.height * 0.3543)),
                  !bubble.paintedHit(NSPoint(x: 1, y: 1)) else { finish(["ok": false, "error": "bubble outline hit mask invalid"]); return }
            checks.append("original thought bubble paints its body and passes transparent corners through")
            hideBubble(animated: false); openSettings()
            @MainActor func webProbe(_ remaining: Int) {
                self.settings?.webView.evaluateJavaScript("document.querySelector('.native-settings')?.dataset.ready === 'true'") { result, error in
                    if result as? Bool == true {
                        checks.append("WKWebView loads local settings and message-backed fetch")
                        verifySettings()
                    } else if remaining > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { webProbe(remaining - 1) } }
                    else { finish(["ok": false, "error": error?.localizedDescription ?? "settings did not load"] ) }
                }
            }
            @MainActor func verifySettings() {
                let script = """
                (() => {
                  const tabs = [...document.querySelectorAll('.native-settings [role=tab]')];
                  if (tabs.map(tab => tab.textContent).join('/') !== '概览/用量/设置') return 'dashboard tabs missing';
                  tabs[2].click();
                  if (document.querySelector('#native-page-settings').hidden || !document.querySelector('#native-page-overview').hidden) return 'settings navigation failed';
                  if (document.querySelectorAll('.native-settings .whale-menu-group').length !== 3) return 'settings groups missing';
                  tabs[0].click();
                  const r = document.querySelector('.native-settings').getBoundingClientRect();
                  if (r.width > innerWidth || r.height > innerHeight + 1) return 'dashboard overflows window';
                  return 'ok';
                })()
                """
                self.settings?.webView.evaluateJavaScript(script) { result, error in
                    guard result as? String == "ok" else { finish(["ok": false, "error": result as? String ?? error?.localizedDescription ?? "settings interaction failed"]); return }
                    checks.append("original overview/usage/settings tabs, groups and viewport layout")
                    self.settings?.webView.takeSnapshot(with: nil) { image, _ in
                        if let bytes = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: bytes), let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: self.data.appendingPathComponent("native-settings.png")) }
                        self.settings?.webView.evaluateJavaScript("document.querySelector('[data-mode=subscription]').click(); true") { _, _ in verifyMode("subscription", 100) }
                    }
                }
            }
            @MainActor func verifyMode(_ mode: String, _ remaining: Int) {
                let condition = "document.documentElement.dataset.accountMode === '\(mode)' && !document.querySelector('[data-mode=\(mode)]').disabled && " +
                    (mode == "subscription" ? "document.querySelectorAll('.whale-quota-box').length === 2 && !document.querySelector('.whale-balance-number')" : "!!document.querySelector('.whale-balance-number')")
                self.settings?.webView.evaluateJavaScript(condition) { result, _ in
                    if result as? Bool != true {
                        if remaining > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { verifyMode(mode, remaining - 1) } }
                        else { finish(["ok": false, "error": "WK mode roundtrip failed: " + mode]) }
                        return
                    }
                    if mode == "subscription" {
                        self.settings?.webView.takeSnapshot(with: nil) { image, _ in
                            if let bytes = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: bytes), let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: self.data.appendingPathComponent("native-settings-subscription.png")) }
                            self.settings?.webView.evaluateJavaScript("document.querySelector('[data-mode=api]').click(); true") { _, _ in verifyMode("api", 100) }
                        }
                    } else {
                        checks.append("WK mode buttons persist subscription/API roundtrip and never mix quota and balance UI")
                        self.settings?.window.close()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                            guard self.settings == nil else { finish(["ok": false, "error": "settings retained after close"]); return }
                            checks.append("settings webview owner released after close"); verifyConversation()
                        }
                    }
                }
            }
            @MainActor func verifyConversation() {
                // A saved sequence in this scratch-only fixture makes the text
                // and image branches deterministic without changing real data.
                let config: JSONObject = ["v": 1, "lib": [], "items": [
                    ["kind": "normal"],
                    ["kind": "custom", "modules": [["type": "random", "lines": [["t": "好模型...↓", "w": 10, "size": 22, "bold": true], ["t": "好女孩...↓", "w": 10, "size": 22, "bold": true]]]]],
                    ["kind": "custom", "modules": [["type": "image", "imgId": "bimg_petpet"]]]
                ]]
                guard let bytes = try? JSONSerialization.data(withJSONObject: config) else { finish(["ok": false, "error": "fixture encode failed"]); return }
                do { try bytes.write(to: self.data.appendingPathComponent(".dshw-bubble.json")) }
                catch { finish(["ok": false, "error": "fixture write failed"]); return }
                var sawFadeIn = false
                self.pet.click?()
                waitFor(100, condition: {
                    let opacity = self.bubble.visibleOpacity
                    if opacity > 0.02 && opacity < 0.98 { sawFadeIn = true }
                    return self.bubblePanel.isVisible && opacity >= 0.99 && self.bubble.value["amount"] as? String == "$12.35"
                }) {
                    guard sawFadeIn else { finish(["ok": false, "error": "bubble entrance had no intermediate opacity"]); return }
                    checks.append("bubble entrance has real intermediate Core Animation opacity")
                    // Sample the complete transition. With Reduce Motion the
                    // 100ms fade can finish before one delayed midpoint probe.
                    var sawCrossfade = false
                    let fadeProbe = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in MainActor.assumeIsolated {
                        if let opacity = self.bubble.outgoingOpacity, opacity > 0.02 && opacity < 0.98 { sawCrossfade = true }
                    } }
                    self.pet.click?()
                    waitFor(100, condition: { self.bubble.value["kind"] as? String == "message" && !self.bubble.isTransitioning }) {
                        fadeProbe.invalidate()
                        guard sawCrossfade else { finish(["ok": false, "error": "text switch had no intermediate opacity"]); return }
                        let previous = self.bubble.value["amount"] as? String
                        capture(self.bubble, "native-message.png")
                        self.pet.click?()
                        waitFor(100, condition: { !self.bubble.isTransitioning && self.bubble.value["amount"] as? String != previous }) {
                            guard self.bubble.value["kind"] as? String == "message" else { finish(["ok": false, "error": "pet refresh returned to money"]); return }
                            checks.append("pet first click shows balance, later clicks crossfade and refresh messages without returning to money")
                            self.bubble.clicked?()
                            waitFor(100, condition: { self.bubble.image.imageValid && !self.bubble.image.isHidden && !self.bubble.isTransitioning }) {
                                capture(self.bubble, "native-message-image.png")
                                var sawFadeOut = false
                                self.bubble.clicked?()
                                waitFor(100, condition: {
                                    let opacity = self.bubble.visibleOpacity
                                    if self.bubbleClosing && opacity > 0.02 && opacity < 0.98 { sawFadeOut = true }
                                    return !self.bubblePanel.isVisible && !self.bubble.image.imageValid
                                }) {
                                    guard sawFadeOut else { finish(["ok": false, "error": "bubble exit had no intermediate opacity"]); return }
                                    checks.append("real JSONL saved sequence: quota → original message → animated petpet → fade out and release image")
                                    verifyRapidReopen()
                                }
                            }
                        }
                    }
                }
            }
            @MainActor func verifyRapidReopen() {
                self.pet.click?()
                waitFor(100, condition: { self.bubblePanel.isVisible && self.bubble.visibleOpacity >= 0.99 }) {
                    self.hideBubble()
                    DispatchQueue.main.asyncAfter(deadline: .now() + self.bubble.fadeDuration / 3) {
                        self.pet.click?()
                        let settleDelay: Double = self.bubble.fadeDuration + self.bubble.textDuration + 0.2
                        DispatchQueue.main.asyncAfter(deadline: .now() + settleDelay) {
                            guard self.bubblePanel.isVisible, !self.bubbleClosing, self.bubble.value["amount"] as? String == "$12.35" else {
                                finish(["ok": false, "error": "old close callback hid reopened bubble"]); return
                            }
                            for _ in 0..<5 { self.pet.click?() }
                            waitFor(100, condition: { !self.bubble.isTransitioning && self.bubble.value["kind"] as? String == "message" }) {
                                let textDelay: Double = self.bubble.textDuration + 0.1
                                DispatchQueue.main.asyncAfter(deadline: .now() + textDelay) {
                                    guard self.bubblePanel.isVisible, self.bubble.value["kind"] as? String == "message", !self.bubble.isTransitioning else {
                                        finish(["ok": false, "error": "rapid pet clicks restored stale content"]); return
                                    }
                                    checks.append("fade-out interruption and five rapid pet clicks preserve the latest scene")
                                    self.hideBubble(animated: false)
                                    finish(["ok": true, "checks": checks])
                                }
                            }
                        }
                    }
                }
            }
            @MainActor func waitFor(_ remaining: Int, condition: @escaping @MainActor () -> Bool, then: @escaping @MainActor () -> Void) {
                if condition() { then() }
                else if remaining > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { waitFor(remaining - 1, condition: condition, then: then) } }
                else { finish(["ok": false, "error": "native conversation transition timed out"]) }
            }
            webProbe(100)
        }
        probe()
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if shutdownComplete { return .terminateNow }
        if terminating { return .terminateCancel }; terminating = true
        inputTimer?.invalidate(); followTimer?.invalidate(); diagnosticTimer?.invalidate(); closeBubble?.invalidate()
        if let monitor = globalClick { NSEvent.removeMonitor(monitor) }; if let monitor = localClick { NSEvent.removeMonitor(monitor) }
        if let monitor = globalMove { NSEvent.removeMonitor(monitor) }
        audio.stop(); pet.pauseAnimation(true); petPanel.orderOut(nil); bubble.resetPresentation(); bubblePanel.orderOut(nil); settings?.window.close()
        ready = false; writeStatus()
        if !backend.process.isRunning { return .terminateNow }
        // Keep the normal main loop alive while Process/pipe callbacks finish.
        // terminateLater enters AppKit's modal termination loop, which can
        // starve the DispatchQueue.main callbacks that complete Node shutdown.
        backend.stop { [weak self] in self?.shutdownComplete = true; NSApp.terminate(nil) }
        return .terminateCancel
    }
}
