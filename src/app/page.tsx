import { ImageGradientUpload } from "@/components/image-gradient-upload";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#efece3] px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <ImageGradientUpload />
      </div>
    </main>
  );
}
