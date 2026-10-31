import AppKit

typealias JSONObject = [String: Any]
typealias RPCReply = (Result<JSONObject, Error>) -> Void
enum NativeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}

final class BackendConnection {
    let process = Process()
    private let input = Pipe(), output = Pipe(), errors = Pipe()
    private var serial = 0
    private var pending: [Int: RPCReply] = [:]
    private var bytes = Data()
    private let readQueue = DispatchQueue(label: "whale.native.protocol")
    var event: ((String, JSONObject) -> Void)?
    var exited: ((Int32) -> Void)?
    var stderr: String = ""
    private var stopped: (() -> Void)?

    func start(root: URL, node: URL, data: URL, fixture: Bool) throws {
        process.executableURL = node
        process.arguments = [root.appendingPathComponent("desktop/native/backend.mjs").path, "--data-dir", data.path]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
        if fixture { environment["WHALE_NATIVE_TEST"] = "1" }
        if fixture && CommandLine.arguments.contains("--fixture-sessions") { environment["WHALE_NATIVE_TEST_SESSIONS"] = "1" }
        process.environment = environment
        process.standardInput = input; process.standardOutput = output; process.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { handle.readabilityHandler = nil; return }
            self?.readQueue.async { [weak self] in self?.receive(chunk) }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.stderr = String((self?.stderr ?? "").suffix(2000)) + (String(data: chunk, encoding: .utf8) ?? "") }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                let callbacks = self.pending.values; self.pending.removeAll()
                for callback in callbacks { callback(.failure(NativeFailure.message("后台已退出"))) }
                let completion = self.stopped; self.stopped = nil
                self.exited?(process.terminationStatus)
                completion?()
            }
        }
        try process.run()
    }

    private func receive(_ chunk: Data) {
        bytes.append(chunk)
        guard bytes.count <= 48 * 1024 * 1024 else { bytes.removeAll(); DispatchQueue.main.async { self.event?("error", ["message": "后台消息超过限制"]) }; return }
        while let newline = bytes.firstIndex(of: 10) {
            let line = bytes.prefix(upTo: newline); bytes.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? JSONObject, value["v"] as? Int == 1 else { continue }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if let name = value["event"] as? String { self.event?(name, value["data"] as? JSONObject ?? [:]); return }
                guard let id = value["id"] as? Int, let callback = self.pending.removeValue(forKey: id) else { return }
                if value["ok"] as? Bool == true { callback(.success(value["result"] as? JSONObject ?? [:])) }
                else { callback(.failure(NativeFailure.message((value["error"] as? JSONObject)?["message"] as? String ?? "本地请求失败"))) }
            }
        }
    }

    func call(_ method: String, _ params: JSONObject = [:], completion: @escaping RPCReply = { _ in }) {
        guard process.isRunning else { completion(.failure(NativeFailure.message("后台尚未启动"))); return }
        serial += 1; let id = serial
        guard var data = try? JSONSerialization.data(withJSONObject: ["v": 1, "id": id, "method": method, "params": params]) else { completion(.failure(NativeFailure.message("无法编码本地请求"))); return }
        pending[id] = completion; data.append(10)
        do { try input.fileHandleForWriting.write(contentsOf: data) }
        catch { pending.removeValue(forKey: id)?(.failure(error)) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 35) { [weak self] in
            self?.pending.removeValue(forKey: id)?(.failure(NativeFailure.message("后台请求超时")))
        }
    }

    func resource(_ route: String, completion: @escaping (Result<(Data, String, Int), Error>) -> Void) {
        call("request", ["route": route]) { result in
            completion(result.flatMap { response in
                guard let text = response["body"] as? String, let data = Data(base64Encoded: text) else { return .failure(NativeFailure.message("素材响应无效")) }
                let headers = response["headers"] as? [String: String] ?? [:]
                return .success((data, headers["content-type"] ?? "application/octet-stream", response["status"] as? Int ?? 500))
            })
        }
    }

    func stop(_ completion: @escaping () -> Void) {
        guard process.isRunning else { DispatchQueue.main.async(execute: completion); return }
        stopped = completion
        call("shutdown")
        try? input.fileHandleForWriting.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in if self?.process.isRunning == true { self?.process.terminate() } }
    }
}
