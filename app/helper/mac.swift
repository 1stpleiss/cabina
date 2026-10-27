// Ayudante del control remoto en Mac: lee órdenes (una por línea, en JSON) y mueve el ratón y pulsa
// teclas con CGEvent. Lo lanza la app solo mientras alguien tiene el control, y macOS le exige el permiso
// de Accesibilidad de Cabina. Órdenes:
//   {"t":"move","x":…,"y":…}                  posición en puntos, en coordenadas globales (arriba a la izquierda)
//   {"t":"down"|"up","b":0|1|2,"x":…,"y":…}   botón izquierdo, central o derecho
//   {"t":"scroll","dx":…,"dy":…}              en píxeles
//   {"t":"key","k":<código de tecla de Mac>,"down":true|false,"mod":true|false}
// Todas llevan "m": modificadores pulsados (1 mayúsculas, 2 control, 4 opción, 8 comando).
import Foundation
import CoreGraphics

var pressed: Int = -1               // botón pulsado ahora (para arrastrar)
var lastDown = Date.distantPast
var lastPos = CGPoint.zero
var clicks: Int64 = 1

func flags(_ m: Int) -> CGEventFlags {
    var f: CGEventFlags = []
    if m & 1 != 0 { f.insert(.maskShift) }
    if m & 2 != 0 { f.insert(.maskControl) }
    if m & 4 != 0 { f.insert(.maskAlternate) }
    if m & 8 != 0 { f.insert(.maskCommand) }
    return f
}

func post(_ e: CGEvent?, _ m: Int) {
    guard let e = e else { return }
    e.flags = flags(m)
    e.post(tap: .cghidEventTap)
}

func mouse(_ type: CGEventType, _ p: CGPoint, _ b: Int, _ m: Int, clickState: Int64 = 1) {
    let button: CGMouseButton = b == 2 ? .right : b == 1 ? .center : .left
    let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)
    e?.setIntegerValueField(.mouseEventClickState, value: clickState)
    if b == 1 { e?.setIntegerValueField(.mouseEventButtonNumber, value: 2) }
    post(e, m)
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let t = o["t"] as? String else { continue }
    let m = (o["m"] as? NSNumber)?.intValue ?? 0
    let p = CGPoint(x: (o["x"] as? NSNumber)?.doubleValue ?? 0, y: (o["y"] as? NSNumber)?.doubleValue ?? 0)
    let b = (o["b"] as? NSNumber)?.intValue ?? 0
    switch t {
    case "move":
        let type: CGEventType = pressed == 0 ? .leftMouseDragged : pressed == 2 ? .rightMouseDragged : pressed == 1 ? .otherMouseDragged : .mouseMoved
        mouse(type, p, max(pressed, 0), m)
    case "down":
        // Doble y triple clic: otro clic en menos de 0,4 s y a menos de 5 puntos
        let near = abs(p.x - lastPos.x) < 5 && abs(p.y - lastPos.y) < 5
        clicks = (Date().timeIntervalSince(lastDown) < 0.4 && near) ? min(clicks + 1, 3) : 1
        lastDown = Date(); lastPos = p; pressed = b
        mouse(b == 2 ? .rightMouseDown : b == 1 ? .otherMouseDown : .leftMouseDown, p, b, m, clickState: clicks)
    case "up":
        pressed = -1
        mouse(b == 2 ? .rightMouseUp : b == 1 ? .otherMouseUp : .leftMouseUp, p, b, m, clickState: clicks)
    case "scroll":
        let dx = Int32(-((o["dx"] as? NSNumber)?.doubleValue ?? 0)), dy = Int32(-((o["dy"] as? NSNumber)?.doubleValue ?? 0))
        post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0), m)
    case "key":
        guard let k = (o["k"] as? NSNumber)?.intValue else { continue }
        let down = (o["down"] as? Bool) ?? true
        let e = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(k), keyDown: down)
        // Las teclas modificadoras cambian el estado de los modificadores, no escriben nada
        if (o["mod"] as? Bool) == true { e?.type = .flagsChanged }
        post(e, m)
    default:
        continue
    }
}
