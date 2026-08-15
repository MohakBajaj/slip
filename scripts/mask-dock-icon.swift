import CoreGraphics
import Foundation
import ImageIO

// Punch a macOS-style squircle into a full-bleed tile so
// app.dock.setIcon() is not a sharp square. Finder still uses
// the unmasked build/icon.png.

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
  fatalError("pass png paths")
}

func load(_ path: String) -> (CGImage, Int, Int) {
  let url = URL(fileURLWithPath: path) as CFURL
  guard
    let src = CGImageSourceCreateWithURL(url, nil),
    let image = CGImageSourceCreateImageAtIndex(src, 0, nil)
  else {
    fatalError("could not read \(path)")
  }
  return (image, image.width, image.height)
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

func squircle(_ size: CGFloat) -> CGPath {
  let path = CGMutablePath()
  let n: CGFloat = 5
  let steps = 240
  let half = size / 2
  for i in 0...steps {
    let t = CGFloat(i) / CGFloat(steps) * 2 * .pi
    let c = cos(t)
    let s = sin(t)
    let x = pow(abs(c), 2 / n) * half * (c < 0 ? -1 : 1) + half
    let y = pow(abs(s), 2 / n) * half * (s < 0 ? -1 : 1) + half
    if i == 0 {
      path.move(to: CGPoint(x: x, y: y))
    } else {
      path.addLine(to: CGPoint(x: x, y: y))
    }
  }
  path.closeSubpath()
  return path
}

for path in paths {
  let (image, width, height) = load(path)
  let size = min(width, height)
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
  ctx.addPath(squircle(CGFloat(size)))
  ctx.clip()
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  guard let out = ctx.makeImage() else {
    fatalError("no image")
  }
  writePng(out, path)
  print("masked \(path)")
}
