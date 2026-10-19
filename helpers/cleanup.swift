import Foundation
import FoundationModels

@main
struct SlipCleanup {
    static func main() async {
        if CommandLine.arguments.dropFirst().contains("--check") {
            emit(availability())
            return
        }
        do {
            let job = try readJob()
            let text = try await edit(job.instructions, job.prompt)
            emit(["text": text])
        } catch {
            emit(["error": String(describing: error)])
            Foundation.exit(1)
        }
    }
}

private func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else {
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

private func availability() -> [String: Any] {
    switch SystemLanguageModel.default.availability {
    case .available:
        return ["available": true]
    case .unavailable(let reason):
        let name: String
        switch reason {
        case .appleIntelligenceNotEnabled:
            name = "appleIntelligenceNotEnabled"
        case .deviceNotEligible:
            name = "deviceNotEligible"
        case .modelNotReady:
            name = "modelNotReady"
        @unknown default:
            name = "unavailable"
        }
        return ["available": false, "reason": name]
    }
}

private func readJob() throws -> (instructions: String, prompt: String) {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard
        let instructions = object?["instructions"] as? String,
        let prompt = object?["prompt"] as? String,
        !prompt.isEmpty
    else {
        throw CocoaError(.coderReadCorrupt)
    }
    return (instructions, prompt)
}

@MainActor
private func edit(_ instructions: String, _ prompt: String) async throws -> String {
    let session = LanguageModelSession(instructions: instructions)
    let response = try await session.respond(to: "\(prompt)")
    return response.content
}
