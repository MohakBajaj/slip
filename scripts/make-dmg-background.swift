import AppKit
import CoreGraphics
import Foundation
import ImageIO

// Paper desk for the DMG window. 1x matches electron-builder window
// size; @2x is packed into a TIFF so Finder stays sharp on retina.

let width1x = 660
let height1x = 400
let outDir = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : "build"

func srgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: r, green: g, blue: b, alpha: a)
}

func writePng(_ image: CGImage, _ path: String) {
  let url = URL(fileURLWithPath: path) as CFURL
  guard
    let dest = CGImageDestinationCreateWithURL(
      url,
      "public.png" as CFString,
      1,
      nil
    )
  else {
    fatalError("could not encode \(path)")
  }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else {
    fatalError("could not write \(path)")
  }
}

func hashNoise(_ x: Int, _ y: Int) -> CGFloat {
  var n =
    UInt64(UInt(bitPattern: x)) &* 1_664_525
    &+ UInt64(UInt(bitPattern: y)) &* 1_013_904_223
  n ^= n >> 13
  n &*= 1_274_126_177
  return CGFloat(n & 1023) / 1023
}

func drawWordmark(_ ctx: CGContext, scale: CGFloat, width: CGFloat) {
  let size = 13 * scale
  let font: NSFont = {
    if
      let desc = NSFont.systemFont(ofSize: size).fontDescriptor.withDesign(.serif),
      let serif = NSFont(descriptor: desc, size: size)
    {
      return serif
    }
    return NSFont(name: "IowanOldStyle-Roman", size: size)
      ?? NSFont.systemFont(ofSize: size, weight: .regular)
  }()
  let text = NSAttributedString(
    string: "SLIP",
    attributes: [
      .font: font,
      .foregroundColor: NSColor(srgbRed: 0.11, green: 0.105, blue: 0.098, alpha: 0.28),
      .kern: 7.2 * scale,
    ]
  )
  let box = text.size()
  let point = CGPoint(x: (width - box.width) / 2, y: 36 * scale)
  ctx.saveGState()
  text.draw(at: point)
  ctx.restoreGState()
}

func drawArrow(_ ctx: CGContext, scale: CGFloat) {
  let amber = srgb(0.769, 0.518, 0.227, 0.92)
  ctx.saveGState()
  ctx.setStrokeColor(amber)
  ctx.setFillColor(amber)
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)
  ctx.setLineWidth(3.2 * scale)

  let start = CGPoint(x: 268 * scale, y: 186 * scale)
  let end = CGPoint(x: 378 * scale, y: 186 * scale)
  let bow = CGPoint(x: 323 * scale, y: 194 * scale)
  ctx.move(to: start)
  ctx.addQuadCurve(to: end, control: bow)
  ctx.strokePath()

  let tip = CGPoint(x: 392 * scale, y: 186 * scale)
  ctx.move(to: CGPoint(x: 372 * scale, y: 174 * scale))
  ctx.addQuadCurve(
    to: CGPoint(x: 372 * scale, y: 198 * scale),
    control: CGPoint(x: 386 * scale, y: 186 * scale)
  )
  ctx.addLine(to: tip)
  ctx.closePath()
  ctx.fillPath()

  ctx.setFillColor(srgb(0.769, 0.518, 0.227, 1))
  ctx.fillEllipse(
    in: CGRect(
      x: start.x - 2.1 * scale,
      y: start.y - 2.1 * scale,
      width: 4.2 * scale,
      height: 4.2 * scale
    )
  )
  ctx.restoreGState()
}

func drawMark(_ ctx: CGContext, scale: CGFloat, width: CGFloat) {
  ctx.saveGState()
  ctx.setStrokeColor(srgb(0.769, 0.518, 0.227, 0.55))
  ctx.setLineCap(.round)
  ctx.setLineWidth(3.4 * scale)
  let x = width / 2
  ctx.move(to: CGPoint(x: x - 7 * scale, y: 348 * scale))
  ctx.addLine(to: CGPoint(x: x + 7 * scale, y: 348 * scale))
  ctx.strokePath()
  ctx.restoreGState()
}

func render(scale: Int) -> CGImage {
  let s = CGFloat(scale)
  let w = width1x * scale
  let h = height1x * scale
  guard
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let ctx = CGContext(
      data: nil,
      width: w,
      height: h,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    fatalError("no bitmap")
  }
  ctx.setAllowsAntialiasing(true)
  ctx.setShouldAntialias(true)
  ctx.translateBy(x: 0, y: CGFloat(h))
  ctx.scaleBy(x: 1, y: -1)

  ctx.setFillColor(srgb(0.937, 0.91, 0.863))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))

  let wash = CGGradient(
    colorsSpace: space,
    colors: [
      srgb(0.996, 0.98, 0.949, 0.7),
      srgb(0.937, 0.91, 0.863, 0),
    ] as CFArray,
    locations: [0, 1]
  )
  if let wash {
    ctx.drawRadialGradient(
      wash,
      startCenter: CGPoint(x: CGFloat(w) * 0.5, y: 188 * s),
      startRadius: 0,
      endCenter: CGPoint(x: CGFloat(w) * 0.5, y: 200 * s),
      endRadius: 340 * s,
      options: [.drawsAfterEndLocation]
    )
  }

  ctx.saveGState()
  ctx.setStrokeColor(srgb(1, 0.99, 0.97, 0.22))
  ctx.setLineWidth(1.2 * s)
  ctx.move(to: CGPoint(x: 0, y: 70 * s))
  ctx.addLine(to: CGPoint(x: CGFloat(w), y: 360 * s))
  ctx.strokePath()
  ctx.setStrokeColor(srgb(0.55, 0.45, 0.28, 0.06))
  ctx.move(to: CGPoint(x: 0, y: 72 * s))
  ctx.addLine(to: CGPoint(x: CGFloat(w), y: 362 * s))
  ctx.strokePath()
  ctx.restoreGState()

  for rest in [CGPoint(x: 168, y: 188), CGPoint(x: 492, y: 188)] {
    let glow = CGGradient(
      colorsSpace: space,
      colors: [
        srgb(0.82, 0.76, 0.66, 0.18),
        srgb(0.82, 0.76, 0.66, 0),
      ] as CFArray,
      locations: [0, 1]
    )
    if let glow {
      let center = CGPoint(x: rest.x * s, y: (rest.y + 18) * s)
      ctx.drawRadialGradient(
        glow,
        startCenter: center,
        startRadius: 0,
        endCenter: center,
        endRadius: 54 * s,
        options: []
      )
    }
  }

  ctx.setStrokeColor(srgb(0.769, 0.518, 0.227, 0.42))
  ctx.setLineCap(.round)
  ctx.setLineWidth(0.9 * s)
  let rule = 28 * s
  let mid = CGFloat(w) / 2
  ctx.move(to: CGPoint(x: mid - rule, y: 58 * s))
  ctx.addLine(to: CGPoint(x: mid + rule, y: 58 * s))
  ctx.strokePath()

  NSGraphicsContext.saveGraphicsState()
  let ns = NSGraphicsContext(cgContext: ctx, flipped: true)
  NSGraphicsContext.current = ns
  drawWordmark(ctx, scale: s, width: CGFloat(w))
  NSGraphicsContext.restoreGraphicsState()

  drawArrow(ctx, scale: s)
  drawMark(ctx, scale: s, width: CGFloat(w))

  if let data = ctx.data {
    let stride = ctx.bytesPerRow
    for y in 0..<h {
      for x in 0..<w {
        let n = hashNoise(x, y) * 0.045 - 0.02
        let i = y * stride + x * 4
        let ptr = data.advanced(by: i).assumingMemoryBound(to: UInt8.self)
        for c in 0..<3 {
          let next = CGFloat(ptr[c]) + n * 255
          ptr[c] = UInt8(max(0, min(255, next.rounded())))
        }
      }
    }
  }

  guard let image = ctx.makeImage() else {
    fatalError("no image")
  }
  return image
}

try FileManager.default.createDirectory(
  atPath: outDir,
  withIntermediateDirectories: true
)

let one = render(scale: 1)
let two = render(scale: 2)
writePng(one, "\(outDir)/background.png")
writePng(two, "\(outDir)/background@2x.png")
print("wrote \(outDir)/background.png")
print("wrote \(outDir)/background@2x.png")
