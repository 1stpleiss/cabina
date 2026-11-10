// Ayudante del audio del sistema en Mac (macOS 14.2 o posterior): captura lo que suena en el ordenador con un
// "process tap" de Core Audio, dejando fuera los procesos de Cabina (las voces y el DAW que llegan), para que los
// demás no se oigan a sí mismos. Lo lanza la app al compartir la pantalla con "Audio del sistema" (app/audio.js) y
// solo está abierto mientras tanto.
// Salida por stdout: una línea "sr <frecuencia>" y después audio en float32 estéreo intercalado (L R L R...).
// Argumentos: --excluir-pid <pid> (varios) y --excluir-bundle <prefijo del identificador> (varios).
// Se cierra al cerrarse su stdin (la app ha terminado) o con SIGTERM.
import Foundation
import CoreAudio
import AudioToolbox

setvbuf(stdout, nil, _IONBF, 0)
func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }

// Se compila para macOS 14.2 o posterior (app.yml); la app no lo lanza en sistemas anteriores (audio.js)

// ---------- argumentos ----------
var excludedPids = Set<pid_t>(), excludedBundles: [String] = []
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    if a == "--excluir-pid", let v = args.next(), let p = pid_t(v) { excludedPids.insert(p) }
    else if a == "--excluir-bundle", let v = args.next() { excludedBundles.append(v) }
}

// ---------- utilidades de Core Audio ----------
func address(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func getValue<T>(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector, _ initial: T) -> T? {
    var addr = address(sel), size = UInt32(MemoryLayout<T>.size), v = initial
    let st = withUnsafeMutablePointer(to: &v) { AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0) }
    return st == noErr ? v : nil
}
func getString(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var addr = address(sel), size = UInt32(MemoryLayout<CFString?>.size)
    var s: Unmanaged<CFString>? = nil
    let st = withUnsafeMutablePointer(to: &s) { AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0) }
    guard st == noErr, let v = s else { return nil }
    return v.takeRetainedValue() as String
}
func getIDs(_ id: AudioObjectID, _ sel: AudioObjectPropertySelector) -> [AudioObjectID] {
    var addr = address(sel), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &list) == noErr else { return [] }
    return list
}
let system = AudioObjectID(kAudioObjectSystemObject)

// Procesos de audio de Cabina: por PID (los que da la app) o por identificador (sus procesos auxiliares)
func cabinaProcesses() -> [AudioObjectID] {
    getIDs(system, kAudioHardwarePropertyProcessObjectList).filter { obj in
        if let pid: pid_t = getValue(obj, kAudioProcessPropertyPID, 0), excludedPids.contains(pid) { return true }
        if let b = getString(obj, kAudioProcessPropertyBundleID) { return excludedBundles.contains { b.hasPrefix($0) } }
        return false
    }
}

// ---------- tap y dispositivo agregado ----------
let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: cabinaProcesses())
desc.uuid = UUID()
desc.muteBehavior = .unmuted
desc.isPrivate = true
desc.name = "Cabina: audio del sistema"
var tapID = AudioObjectID(kAudioObjectUnknown)
guard AudioHardwareCreateProcessTap(desc, &tapID) == noErr else { fail("no se pudo crear el tap") }

guard let outDev: AudioObjectID = getValue(system, kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)),
      let outUID = getString(outDev, kAudioDevicePropertyDeviceUID) else { fail("sin salida de audio") }
let aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Cabina: audio del sistema",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: outUID,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
guard AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID) == noErr else {
    AudioHardwareDestroyProcessTap(tapID); fail("no se pudo crear el dispositivo agregado")
}

guard let fmt: AudioStreamBasicDescription = getValue(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription()),
      fmt.mFormatFlags & kAudioFormatFlagIsFloat != 0, fmt.mBitsPerChannel == 32 else { fail("formato del tap inesperado") }
FileHandle.standardOutput.write("sr \(Int(fmt.mSampleRate))\n".data(using: .utf8)!)

// Si se abren o cierran procesos de Cabina (el de audio puede arrancar después), se actualiza la lista excluida
let queue = DispatchQueue(label: "cabina.audio")
var procAddr = address(kAudioHardwarePropertyProcessObjectList)
AudioObjectAddPropertyListenerBlock(system, &procAddr, queue) { _, _ in
    desc.processes = cabinaProcesses()
    var addr = address(kAudioTapPropertyDescription)
    var d = desc
    _ = withUnsafeMutablePointer(to: &d) { AudioObjectSetPropertyData(tapID, &addr, 0, nil, UInt32(MemoryLayout<CATapDescription>.size), $0) }
}

// ---------- captura: float32 estéreo intercalado a stdout ----------
let out = DispatchQueue(label: "cabina.audio.salida")
var procID: AudioDeviceIOProcID?
let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, input, _, _, _ in
    let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard abl.count > 0, let d0 = abl[0].mData else { return }
    var data: Data
    if abl.count == 1 {
        let ch = Int(abl[0].mNumberChannels), n = Int(abl[0].mDataByteSize) / 4 / max(ch, 1)
        let src = d0.assumingMemoryBound(to: Float.self)
        if ch == 2 { data = Data(bytes: d0, count: n * 8) }
        else {
            var buf = [Float](repeating: 0, count: n * 2)
            for i in 0..<n { let l = src[i * ch], r = ch > 1 ? src[i * ch + 1] : l; buf[2 * i] = l; buf[2 * i + 1] = r }
            data = buf.withUnsafeBytes { Data($0) }
        }
    } else {
        let n = Int(abl[0].mDataByteSize) / 4
        let l = d0.assumingMemoryBound(to: Float.self)
        let r = (abl[1].mData ?? d0).assumingMemoryBound(to: Float.self)
        var buf = [Float](repeating: 0, count: n * 2)
        for i in 0..<n { buf[2 * i] = l[i]; buf[2 * i + 1] = r[i] }
        data = buf.withUnsafeBytes { Data($0) }
    }
    out.async { FileHandle.standardOutput.write(data) } // fuera del hilo de audio
}
guard ioStatus == noErr, let pid = procID, AudioDeviceStart(aggID, pid) == noErr else {
    AudioHardwareDestroyAggregateDevice(aggID); AudioHardwareDestroyProcessTap(tapID); fail("no se pudo empezar a capturar")
}

// ---------- cierre ----------
func cleanup() -> Never {
    AudioDeviceStop(aggID, pid)
    AudioDeviceDestroyIOProcID(aggID, pid)
    AudioHardwareDestroyAggregateDevice(aggID)
    AudioHardwareDestroyProcessTap(tapID)
    exit(0)
}
signal(SIGTERM, SIG_IGN); signal(SIGPIPE, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { cleanup() }
term.resume()
DispatchQueue.global().async { while readLine() != nil {}; DispatchQueue.main.async { cleanup() } }
dispatchMain()
