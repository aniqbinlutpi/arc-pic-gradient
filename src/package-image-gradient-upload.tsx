"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { CSSProperties } from "react";

import { AnimatedThemeToggler } from "./components/ui/animated-theme-toggler";
import { loadImageFromUrl, repairImageUrl, revokeObjectUrls } from "./lib/image-repair";

export type ImageGradientUploadProps = {
  className?: string;
  title?: string;
  description?: string;
};

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
  const image = await loadImageFromUrl(url);

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

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function ImageGradientUpload({
  className = "",
  title = "Adding Background Tool (ABT)",
  description = "Upload an image and generate a soft gradient background from its colors.",
}: ImageGradientUploadProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState<string | null>(null);
  const [repairedPreviewUrl, setRepairedPreviewUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasPreviewDecodeError, setHasPreviewDecodeError] = useState(false);
  const [palette, setPalette] = useState<RGB[]>(DEFAULT_COLORS);
  const [fileBaseName, setFileBaseName] = useState<string>("image");
  const [isDownloading, setIsDownloading] = useState(false);
  const [, setIsRepairing] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      revokeObjectUrls(previewUrl, originalPreviewUrl, repairedPreviewUrl);
    };
  }, [previewUrl, originalPreviewUrl, repairedPreviewUrl]);

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

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
      setImageError(null);
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!originalPreviewUrl) {
      setPreviewUrl(null);
      return;
    }

    if (!isDarkMode) {
      setPreviewUrl(originalPreviewUrl);
      return;
    }

    if (repairedPreviewUrl) {
      setPreviewUrl(repairedPreviewUrl);
      return;
    }

    if (!uploadedFile) {
      setPreviewUrl(originalPreviewUrl);
      return;
    }

    let isCancelled = false;
    setIsRepairing(true);

    repairImageUrl(uploadedFile)
      .then((repairedUrl) => {
        if (isCancelled) {
          revokeObjectUrls(repairedUrl);
          return;
        }

        setRepairedPreviewUrl((current) => {
          revokeObjectUrls(current);
          return repairedUrl;
        });
        setPreviewUrl(repairedUrl);
        setHasPreviewDecodeError(false);
        setImageError(null);
      })
      .catch((error) => {
        if (!isCancelled) {
          setPreviewUrl(originalPreviewUrl);
          setImageError(error instanceof Error ? error.message : "Unable to repair this image.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsRepairing(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isDarkMode, originalPreviewUrl, repairedPreviewUrl, uploadedFile]);

  const gradientStyle = useMemo(() => {
    const colors = palette.length >= 4 ? palette : DEFAULT_COLORS;

    return {
      backgroundImage: `
        radial-gradient(circle at 16% 18%, ${rgbToCss(colors[0], 0.82)} 0%, transparent 52%),
        radial-gradient(circle at 85% 22%, ${rgbToCss(colors[1], 0.76)} 0%, transparent 58%),
        radial-gradient(circle at 52% 82%, ${rgbToCss(colors[2], 0.72)} 0%, transparent 62%),
        linear-gradient(135deg, ${rgbToCss(colors[3], 0.35)} 0%, ${rgbToCss(colors[1], 0.3)} 100%)
      `,
    } as CSSProperties;
  }, [palette]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    revokeObjectUrls(previewUrl, originalPreviewUrl);
    setUploadedFile(file);
    setRepairedPreviewUrl(null);
    setHasPreviewDecodeError(false);
    setFileBaseName(file.name.replace(/\.[^/.]+$/, "") || "image");
    setImageError(null);
    const objectUrl = URL.createObjectURL(file);
    setOriginalPreviewUrl(objectUrl);
    setPreviewUrl(isDarkMode ? null : objectUrl);
  };

  const handleRemoveImage = () => {
    revokeObjectUrls(previewUrl, originalPreviewUrl, repairedPreviewUrl);
    setUploadedFile(null);
    setOriginalPreviewUrl(null);
    setRepairedPreviewUrl(null);
    setPreviewUrl(null);
    setHasPreviewDecodeError(false);
    setFileBaseName("image");
    setPalette(DEFAULT_COLORS);
    setImageError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownload = async () => {
    if (!previewUrl || isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      const image = await loadImageFromUrl(previewUrl);

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
      let drawWidth = imageSize;
      let drawHeight = imageSize;
      let dx = padding;
      let dy = padding;

      if (imageRatio > 1) {
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
    } catch (error) {
      setImageError(
        error instanceof Error
          ? error.message
          : "This image cannot be downloaded in the current mode.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`w-full max-w-[760px] rounded-xl border border-white/60 bg-white/70 p-4 shadow-xl backdrop-blur-sm transition-colors duration-300 dark:border-white/10 dark:bg-zinc-900/80 ${className}`}>
      <div className="space-y-1 pb-4 text-center sm:text-left">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold text-zinc-900 transition-colors duration-300 dark:text-zinc-100 sm:text-2xl">{title}</h2>
          <AnimatedThemeToggler
            className={`relative mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 shadow-sm outline-none transition-all duration-300 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 ${
              isDarkMode
                ? "bg-zinc-800/95 text-zinc-100 hover:bg-zinc-700"
                : "bg-white/85 text-zinc-500 hover:bg-white"
            }`}
          />
        </div>
        <p className="text-sm text-zinc-600 transition-colors duration-300 dark:text-zinc-300">
          {description}
        </p>
      </div>

      <div className="space-y-4 sm:space-y-5">
        <div className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/40 p-3 transition-colors duration-300 dark:border-white/10 dark:bg-white/5 sm:p-4" style={gradientStyle}>
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 top-6 h-40 w-40 rounded-full opacity-60 blur-3xl sm:h-48 sm:w-48" style={{ backgroundColor: rgbToCss(palette[0] ?? DEFAULT_COLORS[0], 0.72) }} />
            <div className="absolute right-0 top-16 h-44 w-44 rounded-full opacity-55 blur-3xl sm:h-56 sm:w-56" style={{ backgroundColor: rgbToCss(palette[1] ?? DEFAULT_COLORS[1], 0.68) }} />
            <div className="absolute bottom-0 left-1/3 h-44 w-44 rounded-full opacity-50 blur-3xl sm:h-52 sm:w-52" style={{ backgroundColor: rgbToCss(palette[2] ?? DEFAULT_COLORS[2], 0.62) }} />
          </div>
          <div className="relative mx-auto aspect-square w-full max-w-[min(62vw,42dvh)] overflow-hidden rounded-xl bg-white/20 shadow-2xl ring-1 ring-white/40 backdrop-blur-sm transition-colors duration-300 dark:bg-white/8 dark:ring-white/10 sm:max-w-[min(420px,46dvh)]">
            {previewUrl && !hasPreviewDecodeError ? (
              <>
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full bg-white/85 text-zinc-700 shadow transition hover:bg-white"
                  onClick={handleRemoveImage}
                  aria-label="Remove image"
                  title="Remove image"
                >
                  X
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Uploaded preview"
                  className="h-full w-full object-cover"
                  onError={() => {
                    setHasPreviewDecodeError(true);
                    setImageError(null);
                  }}
                />
              </>
            ) : previewUrl ? (
              <>
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full bg-white/85 text-zinc-700 shadow transition hover:bg-white"
                  onClick={handleRemoveImage}
                  aria-label="Remove image"
                  title="Remove image"
                >
                  X
                </button>
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04))]">
                  <div className="absolute inset-0 opacity-90 [background:repeating-linear-gradient(180deg,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_9px,rgba(20,20,28,0.08)_9px,rgba(20,20,28,0.08)_18px)]" />
                  <div className="absolute inset-0 opacity-80 [background:linear-gradient(90deg,rgba(110,231,255,0.35)_0%,rgba(196,181,253,0.32)_48%,rgba(244,114,182,0.35)_100%)]" />
                  <div className="absolute left-[14%] top-0 h-full w-8 bg-cyan-200/25 blur-md" />
                  <div className="absolute left-[49%] top-0 h-full w-14 bg-fuchsia-300/25 blur-lg" />
                  <div className="absolute left-[68%] top-0 h-full w-6 bg-white/20 blur-md" />
                  <div className="absolute inset-x-0 top-[28%] h-10 bg-white/14 blur-xl" />
                  <div className="absolute inset-x-0 bottom-[18%] h-16 bg-violet-300/20 blur-2xl" />
                  <div className="relative z-10 rounded-full border border-white/45 bg-black/30 px-4 py-2 text-xs font-medium uppercase tracking-[0.28em] text-white/80 backdrop-blur-sm">
                    Corrupted
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/45 via-white/20 to-black/10 px-6 text-center text-zinc-700">
                <span className="transition-colors duration-300 dark:text-zinc-300">
                  Select an image to preview it with an extracted gradient background
                </span>
              </div>
            )}
            {imageError && imageError !== "Failed to decode image" ? (
              <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-center text-xs text-white backdrop-blur-sm">
                {imageError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[520px] items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="h-10 flex-1 rounded-md border border-zinc-200 bg-white/90 px-3 text-sm transition-colors duration-300 dark:border-white/10 dark:bg-zinc-950/70 dark:text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-transparent file:px-2 file:py-1 file:text-sm file:font-semibold"
          />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-zinc-900 text-white transition duration-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            onClick={handleDownload}
            disabled={!previewUrl || isDownloading}
            aria-label={isDownloading ? "Preparing download" : "Download image"}
            title={isDownloading ? "Preparing..." : "Download"}
          >
            {isDownloading ? (
              <span className="text-xs">...</span>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
