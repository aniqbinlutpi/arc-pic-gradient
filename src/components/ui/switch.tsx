"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent bg-zinc-300/90 p-0.5 shadow-sm outline-none transition-all duration-300 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 data-[checked]:bg-zinc-800 data-[unchecked]:bg-zinc-300/90 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-6 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.14)] transition-transform duration-300 ease-out data-[checked]:translate-x-5 data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
