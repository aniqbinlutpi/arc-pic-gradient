"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RGB = { r: number; g: number; b: number };

const DEFAULT_COLORS: RGB[] = [
  { r: 198, g: 244, b: 255 },
  { r: 252, g: 109, b: 214 },
  { r: 150, g: 107, b: 255 },
  { r: 252, g: 206, b: 159 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function rgbToCss(color: RGB, alpha = 1) {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

function rgbToHsl(color: RGB) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const gray = l * 255;
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let value = t;

    if (value < 0) {
      value += 1;
    }
    if (value > 1) {
      value -= 1;
    }
    if (value < 1 / 6) {
      return p + (q - p) * 6 * value;
    }
    if (value < 1 / 2) {
      return q;
    }
    if (value < 2 / 3) {
      return p + (q - p) * (2 / 3 - value) * 6;
    }

    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

function enhanceColor(color: RGB): RGB {
  const { h, s, l } = rgbToHsl(color);
  const targetSaturation = s < 0.08 ? clamp(s + 0.08, 0.04, 0.2) : clamp(s * 1.22 + 0.03, 0.12, 0.95);
  const targetLightness = clamp(l < 0.2 ? l + 0.12 : l * 1.04 + 0.01, 0.14, 0.88);
  return hslToRgb(h, targetSaturation, targetLightness);
}

async function extractColorsFromImage(url: string): Promise<RGB[]> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return DEFAULT_COLORS;
  }

  canvas.width = 96;
  canvas.height = 96;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let pixelCount = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = imageData[i + 3];

    if (a < 120) {
      continue;
    }

    sumR += r;
    sumG += g;
    sumB += b;
    pixelCount += 1;

    const key = `${Math.round(r / 24) * 24}-${Math.round(g / 24) * 24}-${Math.round(b / 24) * 24}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  if (!pixelCount || buckets.size === 0) {
    return DEFAULT_COLORS;
  }

  const averageColor: RGB = {
    r: sumR / pixelCount,
    g: sumG / pixelCount,
    b: sumB / pixelCount,
  };

  const rankedBuckets = [...buckets.values()]
    .map((bucket) => ({
      color: {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      } satisfies RGB,
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const picked: RGB[] = [];
  const minDistance = 40;

  for (const item of rankedBuckets) {
    const isFarEnough = picked.every((color) => {
      const dr = color.r - item.color.r;
      const dg = color.g - item.color.g;
      const db = color.b - item.color.b;
      return Math.sqrt(dr * dr + dg * dg + db * db) >= minDistance;
    });

    if (isFarEnough) {
      picked.push(item.color);
    }
    if (picked.length >= 4) {
      break;
    }
  }

  const { h: avgH, s: avgS, l: avgL } = rgbToHsl(averageColor);
  while (picked.length < 4) {
    const shift = picked.length * 0.08;
    picked.push(
      hslToRgb(
        (avgH + shift) % 1,
        clamp(avgS < 0.1 ? 0.12 : avgS + 0.06 - shift / 2, 0.08, 0.6),
        clamp(avgL + (picked.length % 2 === 0 ? 0.08 : -0.06), 0.16, 0.82),
      ),
    );
  }

  return picked.map(enhanceColor);
}

export function ImageGradientUpload() {
  const [previewUrl, setPreviewUrl] = useState<string | null>("/me.jpg");
  const [palette, setPalette] = useState<RGB[]>(DEFAULT_COLORS);
  const [fileBaseName, setFileBaseName] = useState<string>("me");
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    let isCancelled = false;

    if (!previewUrl) {
      setPalette(DEFAULT_COLORS);
      return () => {
        isCancelled = true;
      };
    }

    extractColorsFromImage(previewUrl)
      .then((colors) => {
        if (!isCancelled) {
          setPalette(colors);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setPalette(DEFAULT_COLORS);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [previewUrl]);

  const gradientStyle = useMemo(() => {
    const colors = palette.length >= 4 ? palette : DEFAULT_COLORS;

    return {
      backgroundImage: `
        radial-gradient(circle at 16% 18%, ${rgbToCss(colors[0], 0.82)} 0%, transparent 52%),
        radial-gradient(circle at 85% 22%, ${rgbToCss(colors[1], 0.76)} 0%, transparent 58%),
        radial-gradient(circle at 52% 82%, ${rgbToCss(colors[2], 0.72)} 0%, transparent 62%),
        linear-gradient(135deg, ${rgbToCss(colors[3], 0.35)} 0%, ${rgbToCss(colors[1], 0.3)} 100%)
      `,
    };
  }, [palette]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setFileBaseName(file.name.replace(/\.[^/.]+$/, "") || "image");

  };

  const handleRemoveImage = () => {
    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setFileBaseName("image");
    setPalette(DEFAULT_COLORS);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  };

  const handleDownload = async () => {
    if (!previewUrl || isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = previewUrl;
      });

      const colors = palette.length >= 4 ? palette : DEFAULT_COLORS;
      const canvas = document.createElement("canvas");
      const size = 1200;
      const padding = 150;
      const imageSize = size - padding * 2;

      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, rgbToCss(colors[0], 0.92));
      gradient.addColorStop(0.45, rgbToCss(colors[1], 0.86));
      gradient.addColorStop(1, rgbToCss(colors[2], 0.82));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      const drawBlurBlob = (x: number, y: number, radius: number, color: RGB, alpha: number) => {
        ctx.save();
        ctx.filter = "blur(80px)";
        ctx.globalAlpha = alpha;
        ctx.fillStyle = rgbToCss(color);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      drawBlurBlob(size * 0.18, size * 0.22, 180, colors[0], 0.7);
      drawBlurBlob(size * 0.84, size * 0.24, 220, colors[1], 0.58);
      drawBlurBlob(size * 0.56, size * 0.84, 210, colors[2], 0.52);
      drawBlurBlob(size * 0.24, size * 0.78, 180, colors[3], 0.45);

      ctx.save();
      drawRoundedRect(ctx, padding - 6, padding - 6, imageSize + 12, imageSize + 12, 42);
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      drawRoundedRect(ctx, padding, padding, imageSize, imageSize, 36);
      ctx.clip();

      const imageRatio = image.width / image.height;
      const frameRatio = 1;
      let drawWidth = imageSize;
      let drawHeight = imageSize;
      let dx = padding;
      let dy = padding;

      if (imageRatio > frameRatio) {
        drawWidth = imageSize * imageRatio;
        dx = padding - (drawWidth - imageSize) / 2;
      } else {
        drawHeight = imageSize / imageRatio;
        dy = padding - (drawHeight - imageSize) / 2;
      }

      ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
      ctx.restore();

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${fileBaseName}-gradient.png`;
      link.click();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card className="w-full max-w-[760px] border-white/60 bg-white/70 shadow-xl backdrop-blur-sm">
      <CardHeader className="space-y-1 pb-4 text-center sm:text-left">
        <CardTitle className="text-xl font-semibold text-zinc-900 sm:text-2xl">Adding Background Tool (ABT)</CardTitle>
        <CardDescription className="text-sm text-zinc-600">
          Upload an image and we generate a soft gradient background from its colors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-5">
        <div className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/40 p-3 sm:p-4" style={gradientStyle}>
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 top-6 h-40 w-40 rounded-full opacity-60 blur-3xl sm:h-48 sm:w-48" style={{ backgroundColor: rgbToCss(palette[0] ?? DEFAULT_COLORS[0], 0.72) }} />
            <div className="absolute right-0 top-16 h-44 w-44 rounded-full opacity-55 blur-3xl sm:h-56 sm:w-56" style={{ backgroundColor: rgbToCss(palette[1] ?? DEFAULT_COLORS[1], 0.68) }} />
            <div className="absolute bottom-0 left-1/3 h-44 w-44 rounded-full opacity-50 blur-3xl sm:h-52 sm:w-52" style={{ backgroundColor: rgbToCss(palette[2] ?? DEFAULT_COLORS[2], 0.62) }} />
          </div>
          <div className="relative mx-auto aspect-square w-full max-w-[min(62vw,42dvh)] overflow-hidden rounded-xl bg-white/20 shadow-2xl ring-1 ring-white/40 backdrop-blur-sm sm:max-w-[min(420px,46dvh)]">
            {previewUrl ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full bg-white/85 text-zinc-700 shadow hover:bg-white"
                  onClick={handleRemoveImage}
                  aria-label="Remove image"
                  title="Remove image"
                >
                  <span aria-hidden="true" className="text-base leading-none">✕</span>
                </Button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Uploaded preview"
                  className="h-full w-full object-cover"
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/45 via-white/20 to-black/10 px-6 text-center text-zinc-700">
                Select an image to preview it with an extracted gradient background
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="h-10 bg-white/90 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-10 min-w-28 bg-zinc-700 text-white hover:bg-zinc-800"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              Upload
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10 min-w-28"
              onClick={handleDownload}
              disabled={!previewUrl || isDownloading}
            >
              {isDownloading ? "Preparing..." : "Download"}
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
