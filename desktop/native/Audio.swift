import AppKit
import AVFoundation

final class PetAudio: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var releasePending = false
    var enabled = true, volume: Float = 0.6
    var set = "duck"
    let root: URL
    init(root: URL) { self.root = root }
    func press() { releasePending = false; player?.stop(); play(press: true) }
    func release() {
        if player?.isPlaying == true { releasePending = true }
        else { play(press: false) }
    }
    private func play(press: Bool) {
        guard enabled, volume > 0 else { player = nil; return }
        let file = set == "fx1" ? (press ? "D1.mp3" : "D2.mp3") : (press ? "Ya1.mp3" : "Ya2.mp3")
        guard let next = try? AVAudioPlayer(contentsOf: root.appendingPathComponent("assets/" + file)) else { player = nil; return }
        player = next; next.volume = volume; next.delegate = self; next.play()
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if releasePending { releasePending = false; play(press: false) } else { self.player = nil }
    }
    func stop() { releasePending = false; player?.stop(); player = nil }
}
