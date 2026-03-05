import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

const root = process.cwd()
const publicDir = path.join(root, "public")

const sourceWebp = path.join(publicDir, "logo.webp")

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function writeSvgWrapper(destPath, size = 180) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="white"/>
  <image href="/logo.webp" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" />
</svg>
`
  await fs.writeFile(destPath, svg, "utf8")
}

async function main() {
  if (!(await exists(sourceWebp))) {
    throw new Error(`Missing source logo at: ${sourceWebp}`)
  }

  const targets = {
    // Required by user
    appleIconPng: path.join(publicDir, "apple-icon.png"),
    iconLight32: path.join(publicDir, "icon-light-32x32.png"),
    iconDark32: path.join(publicDir, "icon-dark-32x32.png"),
    placeholderLogoPng: path.join(publicDir, "placeholder-logo.png"),
    placeholderLogoSvg: path.join(publicDir, "placeholder-logo.svg"),

    // Also referenced by Next metadata / UI
    iconSvg: path.join(publicDir, "icon.svg"),
    appLogoWebp: path.join(publicDir, "app-logo.webp"),

    // Optional: other placeholders in /public
    placeholderSvg: path.join(publicDir, "placeholder.svg"),
    placeholderJpg: path.join(publicDir, "placeholder.jpg"),
    placeholderUserJpg: path.join(publicDir, "placeholder-user.jpg"),
  }

  // PNGs: keep correct PNG bytes (convert from WEBP content)
  await sharp(sourceWebp).resize(180, 180, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(targets.appleIconPng)
  await sharp(sourceWebp).resize(32, 32, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(targets.iconLight32)
  await sharp(sourceWebp).resize(32, 32, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(targets.iconDark32)
  await sharp(sourceWebp).png({ compressionLevel: 9 }).toFile(targets.placeholderLogoPng)

  // SVGs: keep filenames, but render logo.webp
  await writeSvgWrapper(targets.placeholderLogoSvg, 180)
  await writeSvgWrapper(targets.iconSvg, 180)
  await writeSvgWrapper(targets.placeholderSvg, 180)

  // JPG placeholders: convert WEBP -> JPG
  await sharp(sourceWebp).jpeg({ quality: 90 }).toFile(targets.placeholderJpg)
  await sharp(sourceWebp).jpeg({ quality: 90 }).toFile(targets.placeholderUserJpg)

  // app-shell references /app-logo.webp; ensure it exists and matches logo.webp
  await fs.copyFile(sourceWebp, targets.appLogoWebp)

  const out = await fs.readdir(publicDir)
  console.log("Updated public assets:", out.filter((f) => f.includes("icon") || f.includes("logo") || f.includes("placeholder")))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

