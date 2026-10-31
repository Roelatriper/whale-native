import AppKit
import WebKit

// All WebKit ownership is confined here; closing settings destroys this object.
final class NativeSettings: NSObject, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
    private let backend: BackendConnection
    private var tasks = Set<ObjectIdentifier>()
    private(set) var window: NSWindow!
    private(set) var webView: WKWebView!
    var closed: (() -> Void)?
    init(backend: BackendConnection) {
        self.backend = backend
        super.init()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(self, forURLScheme: "whale")
        configuration.userContentController.add(self, name: "whale")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration); webView.navigationDelegate = self; webView.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 520), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.minSize = NSSize(width: 360, height: 410)
        window.title = "小鲸鱼"; window.contentView = webView
        window.isReleasedWhenClosed = false; window.delegate = self; window.center()
        webView.load(URLRequest(url: URL(string: "whale://widget/native/settings.html")!))
    }
    func show() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    func windowWillClose(_ notification: Notification) {
        webView.stopLoading(); webView.navigationDelegate = nil; webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "whale")
        webView.configuration.userContentController.removeAllUserScripts()
        tasks.removeAll(); window.contentView = nil; webView = nil; closed?()
    }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let identity = ObjectIdentifier(urlSchemeTask as AnyObject); tasks.insert(identity)
        guard let url = urlSchemeTask.request.url, url.scheme == "whale", url.host == "widget", urlSchemeTask.request.httpMethod == "GET" else { urlSchemeTask.didFailWithError(NativeFailure.message("仅允许本地资源")); tasks.remove(identity); return }
        backend.call("request", ["route": url.path + (url.query.map { "?" + $0 } ?? "")]) { [weak self] result in
            guard self?.tasks.remove(identity) != nil else { return }
            switch result {
            case let .success(reply):
                guard let encoded = reply["body"] as? String, let data = Data(base64Encoded: encoded),
                      let response = HTTPURLResponse(url: url, statusCode: reply["status"] as? Int ?? 500, httpVersion: "HTTP/1.1", headerFields: reply["headers"] as? [String: String]) else { urlSchemeTask.didFailWithError(NativeFailure.message("本地资源无效")); return }
                urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
            case let .failure(error): urlSchemeTask.didFailWithError(error)
            }
        }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { tasks.remove(ObjectIdentifier(urlSchemeTask as AnyObject)) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.scheme == "whale", url.host == "widget",
              let body = message.body as? JSONObject, let id = body["id"] as? Int, let route = body["route"] as? String else { return }
        backend.call("request", ["route": route, "method": body["method"] as? String ?? "GET", "body": body["body"] ?? NSNull()]) { [weak self] result in
            let value: JSONObject
            switch result { case let .success(response): value = ["id": id, "ok": true, "result": response]
            case .failure: value = ["id": id, "ok": false, "error": "本地请求失败，请稍后重试"] }
            guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
            self?.webView?.evaluateJavaScript("window.__whaleNativeReply(" + json + ")", completionHandler: nil)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if navigationAction.shouldPerformDownload && url?.scheme == "blob" { decisionHandler(.download); return }
        decisionHandler(url?.scheme == "whale" && url?.host == "widget" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    static let bridgeScript = #"""
    (() => {
      const pending = new Map(); let serial = 0;
      window.__whaleNativeReply = message => {
        const job = pending.get(message.id); if (!job) return;
        pending.delete(message.id); clearTimeout(job.timer);
        if (!message.ok) { job.reject(Error(message.error)); return; }
        const reply = message.result;
        const bytes = Uint8Array.from(atob(reply.body), char => char.charCodeAt(0));
        job.resolve(new Response(bytes, {status:reply.status, headers:reply.headers}));
      };
      window.fetch = (input, options = {}) => new Promise((resolve, reject) => {
        const route = typeof input === 'string' ? input : input.url;
        const url = new URL(route, location.href);
        if (url.protocol !== 'whale:' || url.host !== 'widget') { reject(Error('设置仅允许本地请求')); return; }
        let body = null;
        try { if (options.body) body = JSON.parse(options.body); } catch { reject(Error('仅支持 JSON 请求')); return; }
        const id = ++serial;
        const timer = setTimeout(() => {pending.delete(id); reject(Error('后台请求超时'));}, 35000);
        pending.set(id, {resolve, reject, timer});
        window.webkit.messageHandlers.whale.postMessage({id, route:url.pathname+url.search, method:options.method || 'GET', body});
      });
    })();
    """#
}
