import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"; // <-- usa el nuevo nombre exportado 'twMerge'

/**
 * Utility function for merging Tailwind classes
 */
export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(...inputs));
}
