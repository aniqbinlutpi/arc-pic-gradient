import { ImageGradientUpload } from "@/components/image-gradient-upload";

export default function Home() {
  return (
    <main className="h-dvh overflow-hidden bg-[#efece3] px-3 py-3 sm:px-4 sm:py-4">
      <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center">
        <ImageGradientUpload />
      </div>
    </main>
  );
}
