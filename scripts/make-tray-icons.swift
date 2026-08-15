import AppKit
import CoreGraphics
import Foundation

// Black-on-clear template glyphs for the menu bar. macOS tints these.
// 18pt @1x and 36pt @2x, named *Template.png so Electron marks them.

let outDir = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : "resources/tray"

let icons = ["slip", "shift", "inbox", "pin", "dot", "fold"]

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

func context(size: Int) -> CGContext {
  guard
    let ctx = CGContext(
      data: nil,
      width: size,
      height: size,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    fatalError("no bitmap")
  }
  ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: CGFloat(size) / 32, y: -(CGFloat(size) / 32))
  ctx.setStrokeColor(CGColor(gray: 0, alpha: 1))
  ctx.setFillColor(CGColor(gray: 0, alpha: 1))
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)
  ctx.setLineWidth(1.9)
  return ctx
}

func drawSlip(_ ctx: CGContext) {
  ctx.saveGState()
  ctx.translateBy(x: 16, y: 16)
  ctx.rotate(by: -10 * .pi / 180)
  ctx.translateBy(x: -16, y: -16)
  let card = CGRect(x: 9, y: 6.5, width: 14, height: 19)
  ctx.addPath(CGPath(roundedRect: card, cornerWidth: 1.6, cornerHeight: 1.6, transform: nil))
  ctx.strokePath()
  ctx.move(to: CGPoint(x: 12.2, y: 13.2))
  ctx.addLine(to: CGPoint(x: 19.6, y: 13.2))
  ctx.move(to: CGPoint(x: 12.4, y: 17.2))
  ctx.addLine(to: CGPoint(x: 18.2, y: 17.2))
  ctx.strokePath()
  ctx.restoreGState()
}

func drawShift(_ ctx: CGContext) {
  ctx.setLineWidth(2.2)
  for apexY in [CGFloat(11.2), CGFloat(18.6)] {
    ctx.move(to: CGPoint(x: 8.2, y: apexY + 5.4))
    ctx.addLine(to: CGPoint(x: 16, y: apexY))
    ctx.addLine(to: CGPoint(x: 23.8, y: apexY + 5.4))
    ctx.strokePath()
  }
}

func drawInbox(_ ctx: CGContext) {
  ctx.move(to: CGPoint(x: 6.5, y: 14))
  ctx.addLine(to: CGPoint(x: 11.2, y: 14))
  ctx.addLine(to: CGPoint(x: 13.2, y: 18.2))
  ctx.addLine(to: CGPoint(x: 18.8, y: 18.2))
  ctx.addLine(to: CGPoint(x: 20.8, y: 14))
  ctx.addLine(to: CGPoint(x: 25.5, y: 14))
  ctx.addLine(to: CGPoint(x: 23.4, y: 24.2))
  ctx.addLine(to: CGPoint(x: 8.6, y: 24.2))
  ctx.closePath()
  ctx.strokePath()
  ctx.move(to: CGPoint(x: 16, y: 7.2))
  ctx.addLine(to: CGPoint(x: 16, y: 16.4))
  ctx.move(to: CGPoint(x: 12.6, y: 11.2))
  ctx.addLine(to: CGPoint(x: 16, y: 7.2))
  ctx.addLine(to: CGPoint(x: 19.4, y: 11.2))
  ctx.strokePath()
}

func drawPin(_ ctx: CGContext) {
  let head = CGRect(x: 10.4, y: 5.6, width: 11.2, height: 11.2)
  ctx.addEllipse(in: head)
  ctx.strokePath()
  ctx.move(to: CGPoint(x: 16, y: 16.6))
  ctx.addLine(to: CGPoint(x: 16, y: 26.4))
  ctx.strokePath()
  ctx.addEllipse(in: CGRect(x: 14.6, y: 9.4, width: 2.8, height: 2.8))
  ctx.fillPath()
}

func drawDot(_ ctx: CGContext) {
  ctx.setLineWidth(2)
  ctx.addEllipse(in: CGRect(x: 8.4, y: 8.4, width: 15.2, height: 15.2))
  ctx.strokePath()
  ctx.addEllipse(in: CGRect(x: 13.6, y: 13.6, width: 4.8, height: 4.8))
  ctx.fillPath()
}

func drawFold(_ ctx: CGContext) {
  ctx.move(to: CGPoint(x: 9, y: 6.5))
  ctx.addLine(to: CGPoint(x: 18.6, y: 6.5))
  ctx.addLine(to: CGPoint(x: 23, y: 11.2))
  ctx.addLine(to: CGPoint(x: 23, y: 25.5))
  ctx.addLine(to: CGPoint(x: 9, y: 25.5))
  ctx.closePath()
  ctx.strokePath()
  ctx.move(to: CGPoint(x: 18.6, y: 6.5))
  ctx.addLine(to: CGPoint(x: 18.6, y: 11.2))
  ctx.addLine(to: CGPoint(x: 23, y: 11.2))
  ctx.strokePath()
}

func draw(_ name: String, _ ctx: CGContext) {
  switch name {
  case "slip": drawSlip(ctx)
  case "shift": drawShift(ctx)
  case "inbox": drawInbox(ctx)
  case "pin": drawPin(ctx)
  case "dot": drawDot(ctx)
  case "fold": drawFold(ctx)
  default: fatalError("unknown icon \(name)")
  }
}

try FileManager.default.createDirectory(
  atPath: outDir,
  withIntermediateDirectories: true
)

for name in icons {
  for size in [18, 36] {
    let ctx = context(size: size)
    draw(name, ctx)
    guard let image = ctx.makeImage() else {
      fatalError("no image for \(name) @\(size)")
    }
    let suffix = size == 36 ? "@2x" : ""
    let path = "\(outDir)/\(name)Template\(suffix).png"
    writePng(image, path)
    print("wrote \(path)")
  }
}
