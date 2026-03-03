import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatStatusLabel(status: string): string {
  return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
